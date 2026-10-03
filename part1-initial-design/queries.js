// Example workloads for Part 1.
db = db.getSiblingDB("shop");

// Q1 - keyword search (text-index fallback)
db.products.find(
  { $text: { $search: "wireless mouse" }, active: true },
  { score: { $meta: "textScore" }, name: 1, price: 1 }
).sort({ score: { $meta: "textScore" } }).limit(20);

// Q2 - browse category sorted by price (uses {categoryId, price})
db.products.find({ categoryId: db.products.findOne({ sku: "LAP-001" }).categoryId, active: true })
  .sort({ price: 1 }).limit(24);

// Q3 - product detail
db.products.findOne({ slug: "acme-laptop-14" });

// Q4 - place an order: atomic stock decrement + insert inside one transaction
function placeOrder(customerId, lines /* [{productId, qty}] */) {
  const session = db.getMongo().startSession();
  const sdb = session.getDatabase("shop");
  session.startTransaction({ readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
  try {
    const items = [];
    let subtotal = 0;
    for (const l of lines) {
      // conditional update => cannot oversell
      const r = sdb.inventory.updateOne(
        { _id: l.productId, stock: { $gte: l.qty } },
        { $inc: { stock: -l.qty }, $set: { updatedAt: new Date() } });
      if (r.modifiedCount !== 1) throw new Error("Out of stock: " + l.productId);
      const p = sdb.products.findOne({ _id: l.productId });
      const line = parseFloat(p.price.toString()) * l.qty;
      subtotal += line;
      items.push({ productId: p._id, sku: p.sku, name: p.name, unitPrice: p.price,
                   qty: NumberInt(l.qty), lineTotal: NumberDecimal(line.toFixed(2)) });
    }
    const total = NumberDecimal(subtotal.toFixed(2));
    const u = sdb.users.findOne({ _id: customerId });
    sdb.orders.insertOne({
      orderNumber: new ObjectId().toString(), customerId,
      customer: { name: u.name, email: u.email },
      shippingAddress: u.addresses.find(a => a.isDefault),
      items, totals: { subtotal: total, shipping: NumberDecimal("0"), tax: NumberDecimal("0"), grand: total },
      payment: { method: "card", status: "pending" },
      status: "PLACED", delivery: {}, statusHistory: [{ status: "PLACED", at: new Date() }],
      version: NumberInt(1), createdAt: new Date(), updatedAt: new Date() });
    session.commitTransaction();
  } catch (e) { session.abortTransaction(); throw e; }
  finally { session.endSession(); }
}

// Q5 - customer order history
db.orders.find({ customerId: db.users.findOne()._id }).sort({ createdAt: -1 }).limit(20);

// Q6 - status lookup
// db.orders.findOne({ orderNumber: "<id>" }, { status: 1, delivery: 1, statusHistory: 1 });

// Status update with optimistic concurrency
function advanceStatus(orderNumber, expectedVersion, next) {
  return db.orders.updateOne(
    { orderNumber, version: expectedVersion },
    { $set: { status: next, updatedAt: new Date() },
      $inc: { version: 1 },
      $push: { statusHistory: { status: next, at: new Date() } } });
}

// Q7 - ops queue
db.orders.find({ status: { $in: ["PAID", "PACKED"] } }).sort({ createdAt: 1 }).limit(100);
