// Part 2 - run against a mongos of a sharded cluster.
// Prereq: shards already added (sh.addShard("shardA/hostA1:27018,hostA2:27018,hostA3:27018") ...)
db = db.getSiblingDB("shop");

sh.enableSharding("shop");

// --- orders: hashed customerId => even writes, customer history is single-shard
db.orders.createIndex({ customerId: "hashed" });
sh.shardCollection("shop.orders", { customerId: "hashed" });

// Indexes keep working per shard. orderNumber uniqueness can no longer be enforced
// globally by a unique index (it doesn't contain the shard key), so make it unique
// by construction (ObjectId/ULID) and keep a non-unique lookup index:
db.orders.dropIndex("orderNumber_1");
db.orders.createIndex({ customerId: 1, orderNumber: 1 }, { unique: true }); // unique per customer, includes shard key prefix
db.orders.createIndex({ customerId: 1, createdAt: -1 });                    // Q5 targeted
// Ops queue (Q7) is a scatter-gather query by design: run it on secondaries, off the checkout path.
// db.orders.find({status:"PAID"}).readPref("secondary")

// --- inventory: hashed _id (= productId)
sh.shardCollection("shop.inventory", { _id: "hashed" });

// --- users: hashed _id; email uniqueness via a lookup collection (unique index must contain shard key)
sh.shardCollection("shop.users", { _id: "hashed" });
db.createCollection("user_emails");               // { _id: email, userId }
sh.shardCollection("shop.user_emails", { _id: "hashed" });
// _id == email gives a global uniqueness guarantee on insert.

// --- products: unsharded, replicated; scale reads via secondaries + search
// Optional later: sh.shardCollection("shop.products", { categoryId: 1, _id: 1 });

// --- denormalized fields added to products for analytics-friendly reads (updated async by the worker)
// products.stats = { unitsSold30d, revenue30d, trendScore }

// --- TTL for raw events used by analytics staging
db.createCollection("events");
db.events.createIndex({ at: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 14 });

// --- Zone sharding (optional): keep EU customers' orders in EU shards
// sh.addShardToZone("shardEU", "EU");
// sh.updateZoneKeyRange("shop.orders", { customerId: MinKey }, { customerId: MaxKey }, "EU"); // needs a region-prefixed key in practice

printjson(sh.status());
