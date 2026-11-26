# ADR-002: Content-addressed reuse and owner-linked retention

**Date:** 2026-11-16

**Status:** Accepted

**Behavioural contract:**
[Stored-object reuse and retention](../specs/stored-object-reuse-and-retention.feature),
[Trace media blob extraction](../../../specs/trace-processing/trace-media-blob-extraction.feature)

**Related:** [ADR-001](./001-package-boundary.md),
[data-retention service](../../data-retention/specs/data-retention-service.feature)

## Context

Trace ingestion can lift inline media (base64 audio, data-URI images, file
parts) out of span content into Stored Objects (`release_trace_media_extraction`).
Two gaps keep that flag off:

1. `storeFromBytes` mints a fresh id on every call and always answers
   `isDuplicate: false`. The same image twice in one span, an SDK re-export
   after a timeout, or the same recording on many traces each write a new
   object. The trace spec's dedup scenarios passed only against a test fake
   that content-addressed.
2. Nothing deletes trace media. Rows are written with `expiresAt: null`, and
   no scheduled cleanup runs in this module at all. Media outlives the trace's
   retention indefinitely.

Once objects are shared, deleting "the trace's objects" is wrong: another live
trace may point at the same object. Retention also changes after the fact:
`applyRetentionToExistingData` rewrites the TTL of a project's existing rows.
Pins do not: pinning a trace does not change its retention (data-retention
spec), so a pinned trace's rows still expire.

## Decision

1. **Reuse by content.** `storeFromBytes` hashes the bytes before writing. An
   available object of the same project, purpose, SHA-256 and media type is
   reused: no bytes are written, the caller's audience is added if missing,
   and the answer is `isDuplicate: true`. Two concurrent first writes may
   still create two objects; reuse is best-effort, not a uniqueness guarantee.
2. **Owner links.** A new table, `StoredObjectOwner(tenantId, objectId,
ownerKind, ownerId, retainUntil, createdAt, updatedAt)`, records who holds
   an object and until when. Each `storeFromBytes` for a purpose that declares
   a retention category writes the caller's link, or raises its `retainUntil`
   when the link exists, moving its `createdAt` to the latest store with it. A
   reuse adds a link; it never shortens another's.
3. **The purpose declares its retention category.** `trace_content` follows
   `traces`. `retainUntil` is the link's start plus the project's resolved
   days for that category. The start is now, or the caller's `retainFromMs`
   when earlier: trace passes the span's start time, since its rows expire
   from there, so a late or backfilled span's media ends with them. The link's
   `createdAt` is that start, which a re-time counts from. The caller names
   those days on the store (`retentionDays`): trace
   asks data-retention, so Stored Objects holds no peer that could close a
   cycle through data-retention's own peers. Purposes with no category write no
   links and are never swept, so every object stored before this change, and
   every other purpose, keeps today's behaviour.
4. **Sweep by link.** A scheduled process manager in the worker takes one page
   of links past `retainUntil` from each tenant in turn, within a time budget
   below its lease, deletes them, and logically deletes each object left
   with no live link through the existing delete path, whose provider cleanup
   then follows. The object delete is conditional on "no live link" in one
   statement, so a reuse racing the sweep either lands its link first (the
   object survives) or finds the object deleted and writes fresh bytes. A
   tenant that fails leaves the run; the others finish, then the run fails.
5. **Follow retroactive retention.** data-retention records a fact,
   `retention_applied_to_existing_data` (project, category, days), whenever it
   rewrites existing rows: the manual apply, and the raise and apply steps of
   its retention extension. A Stored Objects peer subscriber recomputes the
   project's links for purposes in that category: `createdAt` plus the new
   days. Pins are not followed, matching data-retention.
6. **References stay strings.** A rewritten span part keeps
   `/api/files/{projectId}/{id}`. Readers already treat it as an opaque
   reference and exchange it for a short-lived signed URL; no delivery URL is
   persisted. The trace contract owns the one builder and parser for it.
7. **Project purge clears links.** Deleting a project's objects deletes their
   links in the same pass.

## Consequences

- Repeated media costs one object per project and purpose. A scenario event
  and a trace carrying the same recording remain two objects, because their
  purposes (and audiences) differ.
- Trace media lives exactly as long as the longest-retained trace that
  references it, and follows retroactive retention changes in both
  directions.
- Objects extracted before this change carry no link; they are the few
  projects that opted into the flag early. At store time they are never
  reused for a retained purpose: a link on one would let the sweep delete it
  under the older trace that holds it unrecorded, so their bytes are written
  once more. Before reuse every store minted its own object, so the owner on
  the row is the only one holding it. A background step in trace,
  `trace:link-unowned-trace-media`, asks data-retention for the project's
  trace retention and has Stored Objects link each such object to that owner
  until the retention ends, counted from the object's creation.
- Neither module gains a peer. Stored Objects reads data-retention's fact and
  contract constants only; a store for a retained purpose without
  `retentionDays` is a programming error and throws.
- The pending-upload and deleted-object cleanups remain uncalled; scheduling
  them is separate work.
- A project with indefinite trace retention writes links with no end, which
  the sweep never selects.
- Decision 4 leaves a window of microseconds: under READ COMMITTED, a reuse
  whose link commits after the sweep's UPDATE began but before it reached the
  row is not seen by its NOT EXISTS, and the reuse answers an object just
  deleted. Closing it needs both sides to lock the object row in one
  transaction; the cost of losing it is one span's media failing to load.
- The fact is sent after the retroactive update is triggered, without an
  outbox. If sending fails, the request errors while the rewrite runs; a retry
  re-triggers it and records the fact.
