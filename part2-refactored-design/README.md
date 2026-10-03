# Part 2: Refactored Design

New requirements:
1. **Analytics:** large-scale queries on product trends and sales.
2. **High availability + partition tolerance** for a growing user base.

## Strategy summary

| Strategy | Applied to | Purpose |
|---|---|---|
| **Sharding** | `orders`, `inventory`, `users` (MongoDB) | Spread write load and data volume across shards |
| **Replication** | Every shard = 3-node replica set across 3 availability zones | Automatic failover, no single point of failure |
| **Denormalization / pre-aggregation** | `sales_daily`, `product_daily_stats` rollups | Dashboards read tiny pre-computed documents |
| **CQRS / workload isolation** | Change stream -> Kafka -> Cassandra + analytics secondaries | Analytics never competes with checkout traffic |

## Architecture

```text
 Clients
    |
 API / Services ------------------------------+
    |                                         |
 mongos routers                            Redis (cart, cache)
    |
 +--------+  +--------+  +--------+   Each shard: 3-node replica set
 | Shard1 |  | Shard2 |  | ShardN |   (primary + 2 secondaries, 3 AZs)
 +--------+  +--------+  +--------+
    |  change streams (orders, inventory)
    v
 Kafka  --->  Stream worker (analytics.js) ---> MongoDB rollups (sales_daily, product_daily_stats)
    |
    +------>  Cassandra (sales_by_product_day, events_by_product_hour) for large-scale analytics
```

## Shard key decisions

| Collection | Shard key | Reasoning |
|---|---|---|
| `orders` | `{ customerId: "hashed" }` | Even write distribution (no hot shard from monotonic `_id`/time). The main read, customer history (Q5), targets a single shard. Order lookup by number includes `customerId` from the session, so it stays targeted. |
| `inventory` | `{ _id: "hashed" }` | `_id` is the productId; hashing spreads hot SKUs' neighbours evenly and keeps stock decrements single-shard. |
| `users` | `{ _id: "hashed" }` | Point lookups by id; even distribution. |
| `products` | **Not sharded** initially | Read-heavy and relatively small. Scaled with secondaries (`readPreference: nearest`), search index and Redis cache. Shard on `{categoryId:1,_id:1}` only if it outgrows a replica set. |

Rejected: `createdAt` as a shard key (monotonic, all inserts hit one chunk), and `status` (low cardinality, causes jumbo chunks).

## Consistency / availability trade-offs (CAP view)

| Data | Choice | Settings |
|---|---|---|
| Orders, inventory | **CP**: correctness over availability during a partition | `w: "majority"`, `readConcern: "majority"`, retryable writes. A minority partition cannot accept writes. |
| Product catalog | **AP-leaning**, eventual | Reads from `nearest` secondary; stale by seconds is acceptable. Cached in Redis. |
| Analytics rollups | **AP**, eventually consistent | Updated asynchronously; lag of seconds to a minute. |
| Cart / session | **AP** | Redis replica + TTL; a lost cart is recoverable. |

Trade-offs accepted:
- Majority writes add latency (one network round trip to a second node) in exchange for no lost orders on failover.
- Cross-shard transactions are slower, so the order flow keeps its transaction on one shard where possible (inventory is checked per product; see "Order placement" below).
- Rollups are eventually consistent, so analytics numbers may trail checkout by a few seconds.
- Denormalized rollups cost extra storage and write amplification; raw data remains the source of truth and rollups can be rebuilt.

## Order placement after sharding

Cross-shard distributed transactions (orders on shard A, inventory on shard B) are costly at thousands of TPS. Instead:
1. **Reserve stock** with an atomic conditional `updateOne` on `inventory` (single document, single shard, no transaction).
2. **Insert the order** (`status: PLACED`) with `customerId` routing to one shard.
3. If the insert fails, a compensating **release** restores stock (saga pattern); a reconciliation job releases reservations from orders unpaid after a timeout.

## Files

- [`refactor.js`](refactor.js): sharding, zones and index changes.
- [`replica-set.md`](replica-set.md): replica set / cluster topology and driver settings.
- [`analytics.js`](analytics.js): rollup collections, aggregation pipelines, change stream worker.
- [`cassandra.cql`](cassandra.cql): wide-column analytics tables.
