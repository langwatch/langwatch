# Log processing - one map projection, on purpose

There is exactly one projection in this pipeline, `canonicalLogStorage`, and it
is a map projection for the same reason the metric pipeline has no folds: a log
record is immutable and content-addressed. `RecordId` is derived from the
canonical payload, `getAggregateId` returns it, and every record is its own
aggregate of one event.

A log line has no lifecycle. Nothing about it changes after it arrives, so there
is no state to fold and no reason to pay for one.

The store writes `log_records` (canonical, authoritative) and
`log_usage_estimates` (billing) in the same bulk append. Both are
ReplacingMergeTree keyed on the record identity, so a redelivered batch
collapses on merge instead of billing twice.

## Batching

The command groups on `hash(recordId) % shardCount` and the projection coalesces
whatever the queue hands it into one bulk write per tenant batch. Logs arrive in
bursts of hundreds, and one ClickHouse round trip per record was never going to
hold up. Coalescing requires `bulkAppend` on the store for exactly that reason.

## Correlation lives elsewhere

Folding a log into its trace summary happens in the trace pipeline, via
`recordLogContribution`. That is where the aggregate with real state lives.

Correlation is best-effort and deliberately separate from acceptance. Once the
canonical record is durably enqueued the log is accepted, full stop. If building
or enqueuing the trace contribution then fails, we log it and move on. An OTLP
`partialSuccess` is a permanent verdict, so counting a correlation failure as a
rejection tells every collector in the fleet to throw away a batch we are
holding. Persistence failures answer `503` instead, which is in OTLP's retryable
set, so the sender does the sensible thing.

## The legacy path

`recordLog` and the `logRecordStorage` map projection over in the trace pipeline
are still registered, and they are cutover scaffolding rather than anything you
should build on. Nothing in this build sends `recordLog`, but a pre-canonical
instance mid-rolling-deploy still can, and without a projection reading those
events the records land in neither table. They go when the legacy table goes.
