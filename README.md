# NoSQL E-Commerce Schema Design

Designing and refactoring a NoSQL data layer for an e-commerce application.

| Deliverable | Location |
|---|---|
| Initial schema design (Part 1) | [`part1-initial-design/`](part1-initial-design) |
| Refactored schema (Part 2) | [`part2-refactored-design/`](part2-refactored-design) |
| Reflection report (200-300 words) | [`REFLECTION.md`](REFLECTION.md) |

## Technology choices (polyglot persistence)

| Concern | Store | Model | Why |
|---|---|---|---|
| Users, products, orders, inventory | MongoDB | Document | Flexible product attributes, embedded order lines, multi-document ACID where needed |
| Product search | Atlas Search / Elasticsearch | Inverted index | Full-text, typo tolerance, facets |
| Cart, sessions, hot product cache | Redis | Key-value | Sub-millisecond reads/writes, TTL expiry |
| Sales time series (Part 2) | Cassandra | Wide-column | High write velocity, time-bucketed analytics |
| Pre-aggregated reports (Part 2) | MongoDB rollup collections | Document | Fast dashboard reads |

## Run it

```bash
# Part 1 (MongoDB 7+ via mongosh)
mongosh "mongodb://localhost:27017/shop" part1-initial-design/schema.js
mongosh "mongodb://localhost:27017/shop" part1-initial-design/sample-data.js
mongosh "mongodb://localhost:27017/shop" part1-initial-design/queries.js

# Part 2 (requires a sharded cluster; see part2-refactored-design/README.md)
mongosh "mongodb://mongos:27017/shop" part2-refactored-design/refactor.js
mongosh "mongodb://mongos:27017/shop" part2-refactored-design/analytics.js
cqlsh -f part2-refactored-design/cassandra.cql
```
