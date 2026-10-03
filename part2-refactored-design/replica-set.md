# Replication and availability configuration

## Topology
- **3 shards**, each a **3-node replica set** (1 primary + 2 secondaries), one node per availability zone.
- **3 config servers** (replica set), **2+ mongos routers** behind a load balancer.
- Add a hidden, delayed or analytics-tagged secondary per shard for reporting (`tags: { workload: "analytics" }`, priority 0).
- Redis: primary + replica with Sentinel/Cluster. Kafka: replication factor 3. Cassandra: RF=3 per datacenter.

## Replica set member config (per shard)
```js
rs.initiate({
  _id: "shardA",
  members: [
    { _id: 0, host: "a1:27018", priority: 2, tags: { az: "1" } },
    { _id: 1, host: "a2:27018", priority: 1, tags: { az: "2" } },
    { _id: 2, host: "a3:27018", priority: 0, tags: { az: "3", workload: "analytics" } }
  ],
  settings: { getLastErrorDefaults: { w: "majority", wtimeout: 5000 } }
});
```
Failover: if the primary's AZ is lost, the remaining majority elects a new primary automatically (typically within ~10-12 s). Writers retry via retryable writes.

## Driver settings by workload

| Workload | Write concern | Read concern | Read preference |
|---|---|---|---|
| Place order / stock update | `majority`, `j: true` | `majority` | `primary` |
| Order history | n/a | `majority` | `primaryPreferred` |
| Product browse / detail | n/a | `local` | `nearest` |
| Analytics queries | n/a | `local` | `secondary` with tag `workload:analytics` |
| Event logging | `w: 1` | n/a | n/a |

```js
// Node.js driver example
const client = new MongoClient(uri, { retryWrites: true, w: "majority", readPreference: "primaryPreferred" });
const catalogDb = client.db("shop", { readPreference: "nearest" });
```

## Failure behaviour (CAP)
- **Partition isolates a minority** of a shard: that minority steps down and rejects writes (consistency preserved); the majority side keeps serving. Catalog reads continue from any reachable node, and Redis serves cached pages.
- **Whole-AZ loss:** no data loss for acknowledged (majority) writes.
