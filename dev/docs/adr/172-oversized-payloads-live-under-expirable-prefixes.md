# ADR-172: oversized payloads live under expirable prefixes, never in a stored object

**Date:** 2026-10-06

**Status:** Accepted

**Supersedes in part:** [ADR-040 (durable stored-object offload for evaluation inputs)](./040-durable-stored-object-offload-for-evaluation-inputs.md): the offload target, the key, the lifecycle, the project-delete cascade, the byte ledger and the retention follow-up. ADR-040 still owns the evaluation thresholds, the marker shape, the hard ceiling, the fail-open rule, read resolution at API boundaries and the unconditional row cap.

**Corrects:** [ADR-029 (content-addressed payload store)](../../../packages/group-queue/adrs/029-content-addressed-payload-store.md): it names a "durable-tier sweep" that does not exist, and a key that the code does not write.

**Relates to:** [ADR-022 (event log source of truth)](./022-event-log-source-of-truth.md) (the trace spool), ARCHITECTURE.md §7 "Object storage is a store".

## Context

Four kinds of bytes leave a row, an event or a queue message only because they are too big: evaluation inputs, the trace spool, the group-queue S3 tier, and the staged request bodies sent to langevals and to the studio Lambda. Each grew its own key shape and its own idea of cleanup:

- Evaluation inputs went to the content-addressed stored-objects service (ADR-040), which keeps "no automatic retention". Offloaded inputs outlived the `evaluation_runs` row they belong to and were removed only by the project-delete cascade through the `stored_objects` row.
- The group-queue S3 tier writes `<projectId>/<hash>`. Nothing ever deletes those objects, the spec's "durable-tier sweep" is a Redis-only sweep, and a tenant-first key cannot carry a lifecycle rule.
- The trace spool, langevals staging and studio staging already use kind-first prefixes (`trace-blobs/spool/`, `langevals-staging/`, `studio-staging/`) with an eager delete and an operator lifecycle rule as the orphan bound. The spool's spec says a 24 hour rule while the code, the chart and `.env.example` say 3 days.

S3 lifecycle filters match a leading prefix only (Azure `prefixMatch` and GCS `matchesPrefix` likewise). A tenant-first key can therefore never expire, which is the real defect behind the leaks.

Alex ruled (2026-10-06) that oversized payloads carry no stored-object row: they live under separate object keys with a lifecycle policy that cleans them up, the same for every oversized payload.

## Decision

One scheme, applied per kind.

1. **Kind first, tenant second.** Every oversized object key is `<kind-prefix>/<projectId>/<rest>`. There is never a `stored_objects` row and never a stored-object purpose for an oversized payload.
2. **One lifecycle rule per kind prefix**, set by the operator on the bucket or container, with a documented minimum period. The application never relies on an object outliving that period.
3. **Eager delete where the bytes are transient** (spool, staging), best effort. The lifecycle rule is the bound on orphans.
4. **Reads fail open to the preview.** A missing object (expired, deleted or never written) answers the bounded preview the row or event already carries, with a structured warning, never an error page. A group-queue blob that is missing completes the slot fail-safe, as it does today.
5. **A destination that cannot expire objects refuses the write by name.** The local filesystem always refuses. Azure refuses until the operator confirms the rules, through one `objectRetentionConfirmed` flag that covers every prefix (it replaces the spool's `AZURE_BLOB_SPOOL_RETENTION_CONFIRMED`). For evaluation inputs a refused write is the existing `offloadFailed` preview marker, as an S3 outage is today.
6. **Each owner keeps its prefix as a constant in its own `rules/` file** and builds its repository over the `objectStorage` client (ARCHITECTURE.md §7). No shared registry lives in a framework package. The operator-facing list lives in the chart docs and `.env.example`.

### The prefixes

Existing prefixes stay as they are: operators already hold rules for them and main writes them.

| Kind                | Prefix                                                | Eager delete          | Minimum lifecycle                                 |
| ------------------- | ----------------------------------------------------- | --------------------- | ------------------------------------------------- |
| Trace spool         | `trace-blobs/spool/`                                  | yes                   | 3 days                                            |
| Langevals staging   | `langevals-staging/`                                  | yes                   | 3 days                                            |
| Studio staging      | `studio-staging/`                                     | yes                   | 3 days                                            |
| Group-queue S3 tier | `group-queue/<projectId>/<hash>`                      | no (shared by leases) | 7 days (longer than 3-day lease + 4-day backstop) |
| Evaluation inputs   | `evaluation-inputs/r<days>/<projectId>/<sha256>.json` | no                    | the class's own `<days>`, one rule per class      |

### Evaluation inputs

- The key is content-addressed over the serialised bytes, so a retry or a duplicate input writes one object. Every write is a full PUT, which restarts the lifecycle age.
- The `r<days>` segment is the retention class: evaluation rows carry a per-project `_retention_days` and a bucket rule cannot follow a per-project value, so one rule per class does. A later retention change does not move existing objects.
- The marker keeps its shape (`__lw_stored_object: { id, sizeBytes, sha256, preview, offloadFailed? }`) and new markers set `id` to the sha256 hex. The reader derives the key from the marker, never from a stored location. How the marker names its class is an open point (below).
- Main-era markers (a `stored_objects` KSUID as `id`, bytes at `<projectId>/<sha256>`) are read through a legacy address for one release, then the read is removed. Branch-era markers (`id` = sha256 of the evaluation id) are dropped: they exist only on development stacks.

### Group-queue S3 tier

- The key is `group-queue/<projectId>/<hash>`; the mint stays derived from `(projectId, hash)` and ADR-029's tenant check is unchanged. Every stage is an unconditional PUT, so a deduplicated re-stage refreshes the object's age.
- A blob staged before the move is read from its old key for one release.
- A group parked or dead-lettered for longer than the lifecycle loses its blob and completes fail-safe; replay recovers the work. This is accepted rather than sizing the rule to the longest park.

### Main-era data and deletion

- A one-shot task copies main-era `evaluation_inputs` objects to the new prefix, then deletes the old bytes and the `stored_objects` rows. Neither old prefix can carry a lifecycle rule, so they would otherwise live for ever.
- The `objectStorage` client gains a prefix delete. The project module records a project-deleted fact; each owner of a kind with no eager delete subscribes in a peer subscriber and deletes `<kind>/<projectId>/` (the evaluation-inputs prefix across every class segment).
- Storage accounting for offloaded bytes is not carried forward. Main never surfaced it beyond the row existing, so its scenario is deleted rather than reproduced.

## Rationale / Trade-offs

The alternative kept in ADR-040 (a content-addressed stored object per payload) gave dedup and a delete cascade but could never expire, and it tied an event-sourced payload to a Postgres row the evaluation module did not own. The oversized payload is a derived artefact of a row that itself expires, so it should expire with it: a prefix rule does that without a record, an edge or a sweeper.

Kind-first keys cost one rule per kind and, for evaluation inputs, one per retention class. That is operator work, listed once in the chart docs. The alternative of one `oversized/<kind>/` root was rejected because it would rename three prefixes operators already govern for no gain.

Failing open to the preview is what makes expiry safe: the preview is already in the row, so an expired object degrades a "show full inputs" request and nothing else.

## Consequences

- Stored objects keep "no automatic retention" and it is now true, because oversized payloads are no longer stored objects. The unused payload-staging chain in stored-object (`PayloadStagingRepository`, `S3PayloadStagingRepository`, `PayloadStagingUnavailableError`) is deleted, as is `EVAL_INPUTS_STORED_OBJECT_PURPOSE`; `evaluation_inputs` leaves the legacy audience map once the one-shot task has run.
- Operators gain two new lifecycle rules (`group-queue/`, and one per `evaluation-inputs/r<days>/` class) and one documented period for each existing prefix. Azure and filesystem destinations refuse oversized writes until configured.
- Until the one-shot task and the prefix delete land, old evaluation inputs and old group-queue objects are not reclaimed, as today.
- **Open points, not decided here:** how an effective retention value maps onto the published classes (exact days against rounded tiers, and the indefinite class, which no rule can expire); who owns the project-deleted subscription for the group-queue prefix, since group-queue is a framework package; how the marker carries the class, since a retention change after the write moves the row's class but not the object; and the shape of the one-shot task so it adds no edge between stored-object and evaluation.

## References

- Plan: `dev/docs/plans/oversized-payloads-2026-10-06.md`
- Specs: `specs/evaluations/evaluation-payload-offload.feature`, `packages/group-queue/specs/payload-store-content-addressed.feature`, `modules/trace/specs/large-trace-blob-offload.feature`, `specs/langevals-staging/staged-payload.feature`, `specs/nlp-go/lambda-invoke-payload-staging.feature`
- Related ADRs: ADR-022, ADR-040 (evaluation inputs), ADR-029 (group-queue payload store)
