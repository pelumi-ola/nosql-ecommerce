-- Wide-column store for high-velocity sales/event data and large-scale analytics.
-- Data is modelled around the queries (one table per query).

CREATE KEYSPACE IF NOT EXISTS shop_analytics
  WITH replication = { 'class': 'NetworkTopologyStrategy', 'dc1': 3 };
USE shop_analytics;

-- "Sales of product X over a date range": partition per product per month, clustered by time
CREATE TABLE IF NOT EXISTS sales_by_product_day (
  product_id  uuid,
  month       text,            -- e.g. '2026-10' bounds partition size
  day         date,
  units       counter,
  PRIMARY KEY ((product_id, month), day)
) WITH CLUSTERING ORDER BY (day DESC);
-- revenue is stored in a sibling counter table in minor units (cents) to avoid floats
CREATE TABLE IF NOT EXISTS revenue_by_product_day (
  product_id  uuid,
  month       text,
  day         date,
  revenue_minor counter,
  PRIMARY KEY ((product_id, month), day)
) WITH CLUSTERING ORDER BY (day DESC);

-- "Top products in a category today": partition per category per day
CREATE TABLE IF NOT EXISTS category_sales_by_day (
  category    text,
  day         date,
  product_id  uuid,
  units       counter,
  PRIMARY KEY ((category, day), product_id)
);

-- Raw high-velocity clickstream: view/add-to-cart events for trend analysis
CREATE TABLE IF NOT EXISTS events_by_product_hour (
  product_id  uuid,
  hour        timestamp,       -- truncated to the hour
  event_time  timeuuid,
  event_type  text,            -- view | add_to_cart | purchase
  user_id     uuid,
  PRIMARY KEY ((product_id, hour), event_time)
) WITH default_time_to_live = 7776000   -- 90 days
  AND compaction = { 'class': 'TimeWindowCompactionStrategy',
                     'compaction_window_unit': 'DAYS', 'compaction_window_size': 1 };

-- Consistency per query (set in the driver):
--   writes: LOCAL_QUORUM, analytics reads: LOCAL_ONE (eventual consistency is fine for trends)
