# Metric processing - three map projections and not a single fold

Every projection in here is a map projection. No folds, no reactors. That is
deliberate, and it comes down to one property: a metric data point is immutable
and content-addressed. `PointId` is `sha256(seriesId ‖ canonical payload)`, and
`getAggregateId` returns that same `PointId`, so every point is its own
aggregate of exactly one event.

Folds exist to accumulate state across an aggregate's lifetime. A point has no
lifetime. There is nothing to accumulate, so there is nothing to fold.

## The three

**`metricDataPointStorage`** writes the canonical row. Straight append, one
event in, one row out. `metric_data_points` is a ReplacingMergeTree and
`PointId` is part of its sort key, so the same point arriving twice collapses on
merge rather than double-counting.

**`metricSeriesCatalog`** keeps the per-series metadata (resource, scope,
description, unit) out of the hot row. It dedups on `(TenantId, SeriesId)` with
`LastSeenAt` as the version, so a late point cannot overwrite a newer
observation. Worth knowing: it partitions on `LastSeenAt` while dedupping on a
key that does not include it, so a series seen across two weeks keeps one row
per week forever. Harmless today because nothing reads it. If you are the first
person to add a reader, use `FINAL` or `argMax(…, LastSeenAt)`, and see the
comment in migration `00049`.

**`metricTimeRollup`** is the one that looks like it should be a fold. It reads
before it writes: pull the inserted point's neighbours, work out which 30-second
buckets that changes, then rebuild those buckets. That is a read-modify-write,
which is fold-shaped.

It is still a map projection, because it never accumulates. It recomputes the
affected buckets from the authoritative raw rows every time, so running it twice
produces the same buckets as running it once. A fold would need per-series state
living forever in a store, refolding from the event log on a cache miss, to
derive something the raw table already answers. The cheaper source of truth was
sitting right there.

## Why the sharding matters

All three take a `shardCount` and the command groups on `hash(seriesId) %
shardCount`. A series therefore always lands in one group, and the rollup's
read-modify-write is serialised against itself. Shard on anything else (say
`pointId`) and two workers recompute the same bucket concurrently, with the
usual results.

## What is not here

Exemplar correlation into trace summaries. That lives in the trace pipeline as
`recordMetricCorrelation`, because a trace summary genuinely is an aggregate
with evolving state, which is a fold's actual job. Correlation is also
best-effort: a metric is accepted the moment its canonical row is durably
enqueued, and a failure to link it to a span never turns into an OTLP rejection.
Telling a collector to discard a point we have already stored is worse than
losing the link.
