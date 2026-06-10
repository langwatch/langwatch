# ADR-026: GroupQueue payload envelope — opaque compressed payloads with a routing header

**Date:** 2026-06-10

**Status:** Accepted

## Context

GroupQueue stores every staged job's payload as a plain `JSON.stringify`
string in the per-group data hash (`{queue}:gq:group:{groupId}:data`).
Two costs follow from that:

1. **Redis memory and network.** Span-processing payloads run 2–50 KB of
   highly repetitive JSON (attribute keys, resource labels). At ingestion
   volume this dominates Redis memory, bounding how many events the queue
   can absorb during bursts or downstream slowdowns.
2. **Redis-side CPU on every dispatch.** The dispatch Lua scripts
   `cjson.decode` the *full* payload of every candidate job just to read
   three routing fields (`__pipelineName`, `__jobType`, `__jobName`) for
   the pause-check, and again on failure to bump a per-job-name counter.
   With dispatch batches of up to 200 jobs this can decode megabytes of
   JSON per pass — on Redis's single thread.

The routing fields are injected by the queue-manager facades into the
payload itself, which is why Lua has no cheaper way to see them. The ops
dashboard repository does the same full-payload parse for the same three
fields.

Separately, a payload-offload system already moves very large payloads
(base64-encoded audio/video/images inside LLM interactions) out of Redis
into S3. That system stays: compression does not help much on base64
media, and those payloads should not transit Redis at all. This decision
targets the ordinary span-sized payloads that remain inline.

See [specs/event-sourcing/payload-envelope.feature](../../../specs/event-sourcing/payload-envelope.feature)
for the behavioural contract this decision supports.

## Decision

We will store each job's value in the data hash as a **versioned string
envelope** instead of bare JSON:

```
GQ1|<headerLen>|<headerJson><body>
```

- `<headerJson>` is a tiny JSON object holding only what Redis-side and
  ops-side readers need without touching the body: `v` (version), `e`
  (body encoding: `"j"` raw JSON or `"gz"` gzip+base64), and the routing
  fields `p`/`t`/`n` (pipelineName/jobType/jobName).
- `<body>` is the full payload JSON (including `__context`, `__attempt`,
  and the routing fields, unchanged) — gzip-compressed and
  base64-encoded when the JSON exceeds a 1 KiB threshold, raw otherwise.

The dispatch/fail Lua scripts gain a shared helper that reads routing
metadata from the header alone (a ~100-byte `cjson.decode`), with a
fallback to full-payload decode for **legacy bare-JSON values**, so jobs
staged before a deploy still dispatch, pause, and fail-count correctly.
The ops repository uses the same envelope-aware reader on the TypeScript
side.

Encoding happens once at stage time (and on retry/exhaust re-stage,
where the payload is re-serialized anyway); decoding happens once at
processing time. Handlers, queue-manager facades, dedup semantics, and
all key shapes are untouched — the envelope is invisible outside the
GroupQueue serialization boundary.

## Rationale / Trade-offs

**Why gzip+base64 inside a string, not raw binary?** Lua strings and
Redis bulk strings are binary-safe, but ioredis decodes script replies
as UTF-8 strings by default; carrying raw binary through the dispatch,
drain, retry, and ops paths would require switching every reply path to
`evalBuffer`/Buffer variants and would render the data hash unreadable
to existing ops tooling. Base64 surrenders ~25% of the compression win
but keeps the entire pipeline string-safe with zero changes to the
eval plumbing. Net effect on span JSON is still roughly 4–6×. Raw-binary
storage remains open as a follow-up if the residual size matters.

**Why gzip, not zstd?** `node:zlib` gzip is available and stable on our
Node 24 baseline with no new dependency; zstd's ratio/speed edge is not
worth a format question right now. The envelope's `e` field is exactly
the seam to introduce `"zs"` later without migration.

**Why a header prefix, not a companion hash field?** A second field per
job would have to be written, replaced, moved, and deleted in lockstep
across every Lua path (stage, dedup-replace, dispatch, drain, retry,
exhaust, DLQ move). A prefix on the existing value keeps every
`HSET`/`HGET`/`HDEL` site untouched.

**Why a compression threshold?** gzip+base64 of sub-kilobyte JSON is
frequently *larger* than the input. Small routing events stay raw.

**What is compromised:** payloads in the data hash are no longer
human-readable via `redis-cli` for compressed jobs; debugging requires
the decode helper. Stage/processing paths pay a small async
gzip/gunzip CPU cost (microseconds to low milliseconds per job, off
Redis's thread — which is the point).

## Consequences

- Redis memory per span-sized job drops ~4–6×; the queue absorbs
  proportionally larger bursts before memory pressure.
- Dispatch-time Lua decodes ~100-byte headers instead of full payloads;
  the failed-counter path likewise. Redis CPU per dispatch batch falls
  accordingly.
- The ops dashboard's routing-field extraction gets cheaper (header
  parse) and must go through the shared envelope reader.
- Rolling deploys are safe in the forward direction (new code reads
  legacy values). **Rollback while envelope-encoded jobs are in flight
  is not safe** — old code would fail to `JSON.parse` them and complete
  the group slot without processing. Drain or accept replay if rolling
  back.
- The S3 offload path for oversized media payloads is unaffected and
  remains the mechanism for keeping large blobs out of Redis.

## References

- Related ADRs: [ADR-014](./014-skynet-bullmq-removal.md)
  (Skynet/BullMQ removal),
  [ADR-023](./023-orphan-sweep-reactor-chain.md) (superseded by ADR-025;
  cited only for its description of GroupQueue dispatch mechanics)
- Spec: `specs/event-sourcing/payload-envelope.feature`
