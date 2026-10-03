// Part 2 - denormalised pre-aggregated collections + pipelines + change-stream worker.
db = db.getSiblingDB("shop");

// ---------- Rollup collections ----------
// sales_daily: one doc per day (and per category) => dashboards read a few docs
//   { _id: "2026-10-03|Electronics", day: ISODate, category: "Electronics",
//     orders: 1200, units: 3100, revenue: Decimal128, avgOrderValue: Decimal128 }
db.sales_daily.createIndex({ day: -1, category: 1 });

// product_daily_stats: one doc per product per day => trend queries
//   { _id: "<productId>|2026-10-03", productId, day, units, revenue, orders }
db.product_daily_stats.createIndex({ productId: 1, day: -1 });
db.product_daily_stats.createIndex({ day: -1, units: -1 });     // top sellers of a day

// ---------- Batch (re)build pipeline - idempotent via $merge ----------
function rebuildProductDaily(from, to) {
  db.orders.aggregate([
    { $match: { createdAt: { $gte: from, $lt: to }, status: { $ne: "CANCELLED" } } },
    { $unwind: "$items" },
    { $group: {
        _id: { productId: "$items.productId",
               day: { $dateTrunc: { date: "$createdAt", unit: "day" } } },
        units: { $sum: "$items.qty" },
        revenue: { $sum: "$items.lineTotal" },
        orders: { $sum: 1 } } },
    { $project: { _id: { $concat: [{ $toString: "$_id.productId" }, "|",
                                   { $dateToString: { date: "$_id.day", format: "%Y-%m-%d" } }] },
                  productId: "$_id.productId", day: "$_id.day", units: 1, revenue: 1, orders: 1 } },
    { $merge: { into: "product_daily_stats", whenMatched: "replace", whenNotMatched: "insert" } }
  ], { readPreference: { mode: "secondary", tags: [{ workload: "analytics" }] }, allowDiskUse: true });
}

// ---------- Analytical queries (read rollups, not raw orders) ----------
// Top 10 products by revenue over the last 30 days
function topProducts30d() {
  const since = new Date(Date.now() - 30 * 864e5);
  return db.product_daily_stats.aggregate([
    { $match: { day: { $gte: since } } },
    { $group: { _id: "$productId", units: { $sum: "$units" }, revenue: { $sum: "$revenue" } } },
    { $sort: { revenue: -1 } }, { $limit: 10 },
    { $lookup: { from: "products", localField: "_id", foreignField: "_id", as: "p",
                 pipeline: [{ $project: { name: 1, sku: 1 } }] } }
  ]);
}

// Week-over-week growth for one product
function weeklyTrend(productId) {
  return db.product_daily_stats.aggregate([
    { $match: { productId } },
    { $group: { _id: { $dateTrunc: { date: "$day", unit: "week" } },
                units: { $sum: "$units" }, revenue: { $sum: "$revenue" } } },
    { $sort: { _id: 1 } },
    { $setWindowFields: { sortBy: { _id: 1 },
        output: { prevUnits: { $shift: { output: "$units", by: -1 } } } } },
    { $set: { growthPct: { $cond: [{ $gt: ["$prevUnits", 0] },
        { $multiply: [{ $divide: [{ $subtract: ["$units", "$prevUnits"] }, "$prevUnits"] }, 100] }, null] } } }
  ]);
}

// ---------- Real-time incremental updates (Node.js worker sketch) ----------
/*
const { MongoClient, Decimal128 } = require("mongodb");
(async () => {
  const client = await new MongoClient(process.env.MONGO_URI).connect();
  const db = client.db("shop");
  const resume = await db.collection("worker_state").findOne({ _id: "orders-stream" });

  const stream = db.collection("orders").watch(
    [{ $match: { operationType: "insert" } }],
    { fullDocument: "required", ...(resume && { resumeAfter: resume.token }) });

  for await (const ev of stream) {
    const o = ev.fullDocument, day = new Date(o.createdAt); day.setUTCHours(0,0,0,0);
    const ops = o.items.map(i => ({ updateOne: {
      filter: { _id: `${i.productId}|${day.toISOString().slice(0,10)}` },
      update: { $inc: { units: i.qty, orders: 1, revenue: i.lineTotal },
                $setOnInsert: { productId: i.productId, day } },
      upsert: true } }));
    await db.collection("product_daily_stats").bulkWrite(ops, { ordered: false });
    await db.collection("worker_state").updateOne({ _id: "orders-stream" },
      { $set: { token: ev._id } }, { upsert: true });   // resumable after crash
  }
})();
*/
// Idempotency: store the last processed order _id per worker, or use $merge-based hourly rebuilds
// (rebuildProductDaily) to correct any drift.
