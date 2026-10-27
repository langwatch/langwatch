# Oversized payloads: one scheme (Q213(2))

Status: plan for review, no code. Branch `feat/strict-feature-layout-v0` against `origin/main` 2687513eaa.

Ruling (Alex, 2026-10-06, `.claude/coordinator/rulings-2026-10-05.md`): no StoredObject row. Oversized
payloads live under separate S3 keys with their own lifecycle policy that cleans them up; the same for
every oversized payload. This plan surveys every size-driven offload, proposes the one scheme, the
scenario rewrites and the slices, and lists the decisions only Alex can take (section 6).

Record: §7 "Object storage is a store" (ARCHITECTURE.md:1351): a module names a project and a key over
the `objectStorage` client and builds its own repository; no module composes a driver. Nothing in this
plan adds an `*Api` operation, a peer edge or a contract shape unless section 6 says so.

## 1. Survey

"Size-driven" means: the bytes leave the row, event or message only because they are too big.

| #   | Kind                          | Owner                | Trigger                                                                           | Key today (branch)                                                                                                                                                  | Key on main                                                                                          | Row                                      | Cleanup today                                                                                                                                                                                          | Readers                                                                                    |
| --- | ----------------------------- | -------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 1   | Evaluation inputs             | evaluation           | serialized inputs > 1 MiB (`EVAL_INPUTS_INLINE_MAX_BYTES`), ceiling 50 MiB        | `<projectId>/evaluation-inputs/<sha256(evaluationId)>.json` (`object-storage.evaluation-input.repository.ts:52`)                                                    | `<projectId>/<sha256(bytes)>` via `StoredObjectsService.storeFromBytes`, purpose `evaluation_inputs` | main: `stored_objects` row; branch: none | none on either; main removed bytes on project delete through the row cascade                                                                                                                           | `EvaluationInputsOffloadService.resolve` (evaluation run detail)                           |
| 2   | Trace span/log content        | trace                | command > 256 KiB (`COMMAND_INLINE_THRESHOLD`, ADR-022)                           | durable copy is `event_log` itself (ClickHouse); S3 only as transient spool `trace-blobs/spool/<projectId>/<traceId>/<spanId>` (`trace-spool-location.rules.ts:13`) | same                                                                                                 | none                                     | eager delete after the `event_log` INSERT; operator lifecycle rule on `trace-blobs/spool/` (3 days, chart `_helpers.tpl:1092`); FS refused; Azure refused until `AZURE_BLOB_SPOOL_RETENTION_CONFIRMED` | `TraceBlobStoreService`, `trace-offload-resolution*.service.ts` (read `event_log`, not S3) |
| 3   | Group-queue envelope blobs    | packages/group-queue | shared payload > 256 KiB (`S3_TIER_THRESHOLD_BYTES`); 4 KiB-256 KiB goes to Redis | `<projectId>/<hash128-base64url>` (`tieredBlobStore.ts`, `mintUri`)                                                                                                 | same                                                                                                 | none                                     | Redis tier: lease + 4-day backstop TTL + sweep. **S3 tier: never reclaimed** (only `delete()` for admin callers, `ops.service.ts:144`)                                                                 | `EnvelopeBlobLifecycle` decode; ops queue blob view                                        |
| 4   | Langevals request staging     | evaluation           | body > `LANGEVALS_STAGING_THRESHOLD_BYTES` (SaaS only)                            | `langevals-staging/<projectId>/<kind>/<ms>-<id>.json` (`http.langevals.channel.ts:15,84`)                                                                           | same                                                                                                 | none                                     | eager delete after response; operator lifecycle rule (no documented period)                                                                                                                            | langevals via presigned GET                                                                |
| 5   | Studio (nlpgo Lambda) staging | workflow             | invoke envelope over threshold                                                    | `studio-staging/<projectId>/<suffix>.json` (`nlp-lambda-config.rules.ts:25`)                                                                                        | same                                                                                                 | none                                     | eager delete after invoke (also on failure); operator lifecycle rule                                                                                                                                   | nlpgo via presigned GET                                                                    |
| 6   | Stored-object payload staging | stored-object        | n/a                                                                               | `<keyPrefix>/<suffix>.json` (`s3.payload-staging.repository.ts:54`)                                                                                                 | n/a                                                                                                  | none                                     | n/a                                                                                                                                                                                                    | **unused** (Q217(5))                                                                       |

Not size-driven, so out of the ruling's reach (kept as stored objects, listed so the boundary is explicit):

- Scenario event byte content (`specs/features/scenarios/externalize-event-byte-content.feature`, `@deprecated`):
  every inline audio/image/PDF part is externalised regardless of size and served at `GET /api/files/:id`.
- Trace media extraction (`specs/trace-processing/trace-media-blob-extraction.feature`, purpose `trace_content`,
  `trace-edge-media-extraction.service.ts:22`): media by kind, rendered from a stored-object reference.
  It does pull commands back under the 256 KiB threshold, but the bytes are a user-visible artefact.
- Voice recordings (scenario): fetched from the provider by recording key, not offloaded for size.
- Dataset chunks and the `staging/<projectId>/` direct-upload prefix: the dataset itself, and upload staging.
- Truncation-only caps (scenario run-state `capOversizedString`, trace attribute caps, SQS webhook
  oversize refusal, gateway 32 KB capture): nothing is stored elsewhere.

### Findings the survey turned up

1. **Group-queue S3-tier objects leak** (row 3). The spec says reclaim is lazy via "Redis expiry and
   GroupQueue's durable-tier sweep" (`payload-store-content-addressed.feature:35-36`), but the sweep is Redis
   only; nothing deletes an S3-tier object, and its key is tenant-first so no lifecycle rule can reach it.
   Same on main.
2. **Spec and code disagree on the group-queue key**: the feature says `{projectId}/group-queue/<hash>`
   (`payload-store-content-addressed.feature:27`); main and branch write `<projectId>/<hash>`, the same
   namespace stored objects use (`<projectId>/<sha256-hex>`). Disjoint only by hash encoding.
3. **Evaluation inputs: main-era markers are unreadable on the branch.** Main's marker `id` is a
   `stored_objects` KSUID; the branch reader refuses any id that is not 64 hex (`STORED_INPUT_ID`) and
   answers "absent", so every run offloaded before the deploy shows only its preview. Main's marker also
   carries `sha256` of the serialized bytes, and main's key was `<projectId>/<sha256>` on the project's
   destination, so the old object is addressable **without** the row (section 3.3).
4. **Project deletion no longer removes offloaded evaluation inputs**: main reached them through the
   `stored_objects` cascade (`deleteOwnedBy`); with no row the branch leaves them forever (tenant-first key,
   no lifecycle). The `@unimplemented` scenario `evaluation-payload-offload.feature:103` describes main.
5. **Storage accounting**: main's `getStorageUsageByProject({ purpose })` had no caller outside
   stored-objects, so "offloaded bytes are recorded for storage accounting" (`:90`) was never observable on
   main beyond the row existing. Ops' `MONITORED_TABLES` comment (`storage-stats-collection.service.ts:26`)
   still names `stored_objects` as where evaluation inputs live.
6. **Trace spool period disagrees**: `large-trace-blob-offload.feature:26` says a 24 h lifecycle; the code,
   chart and `.env.example` say 3 days.
7. **Unbound rows**: none of the `evaluation-payload-offload.feature` scenarios is bound on the branch
   (`evaluation-inputs-offload.service.unit.test.ts` carries no `@scenario`); group-queue "A very large
   payload offloads to S3 through the reused object store" is unbound. `stored-object-no-retention-gc.unit.test.ts`
   binds "No automatic retention, time-based GC, or orphan reaping runs", which stays true for stored objects.
8. The purpose constant `EVAL_INPUTS_STORED_OBJECT_PURPOSE` and the `evaluation_inputs` entry in
   `LEGACY_PURPOSE_AUDIENCE` (`stored-object/contract/src/audiences.ts:37,43`) only serve main-era rows.

## 2. The scheme

One rule, applied per kind:

1. **Kind first, tenant second.** Every oversized object key is `<kind-prefix>/<projectId>/<rest>`. S3
   lifecycle filters match a leading prefix only (Azure `prefixMatch` and GCS `matchesPrefix` likewise), so a
   tenant-first key is unexpirable; `trace-spool-location.rules.ts:9-12` already states this. Never a
   `stored_objects` row, never a stored-object purpose.
2. **One lifecycle rule per kind prefix**, set by the operator on the bucket/container, with a documented
   minimum period. The application never relies on an object outliving that period.
3. **Eager delete where the bytes are transient** (staging, spool), best-effort; the lifecycle rule is the
   orphan bound.
4. **Reads fail open to the preview.** A missing object (expired, deleted, or never written) answers the
   bounded preview the row or event already carries, with a structured warning; never an error page.
5. **Destinations that cannot expire refuse the write by name and keep the payload bounded**: the local
   filesystem always; Azure until the operator confirms the rules (generalising
   `AZURE_BLOB_SPOOL_RETENTION_CONFIRMED`, decision D3). For evaluation inputs a refused write is the
   existing `offloadFailed` preview marker, as an S3 outage is today.
6. **Each owner keeps its prefix as a constant in its own `rules/` file** and builds its repository over the
   `objectStorage` client (record §7). No shared registry in a framework package (feature names in
   `packages/` are a defect); the operator-facing list lives in the chart docs and `.env.example`.

### Prefix table (proposed)

| Kind                | Prefix                    | Eager delete                             | Minimum lifecycle                            | Change                          |
| ------------------- | ------------------------- | ---------------------------------------- | -------------------------------------------- | ------------------------------- |
| Trace spool         | `trace-blobs/spool/`      | yes                                      | 3 days                                       | none (fix spec text, finding 6) |
| Langevals staging   | `langevals-staging/`      | yes                                      | 3 days                                       | document the period             |
| Studio staging      | `studio-staging/`         | yes                                      | 3 days                                       | document the period             |
| Group-queue S3 tier | `group-queue/` (D1)       | no (content-addressed, shared by leases) | 7 days (> 3-day lease + 4-day backstop) (D4) | new key + legacy read           |
| Evaluation inputs   | `evaluation-inputs/` (D1) | no                                       | horizon per D2                               | new key + legacy read           |

Existing prefixes stay as they are: operators already hold rules for them and main writes them, so
renaming would be an operator-visible wire change for no gain (D1 option A).

## 3. Per-kind changes

### 3.1 Evaluation inputs (evaluation)

- Key: `evaluation-inputs/<projectId>/<sha256(serialized bytes)>.json`. Content-addressed, so a retry or a
  duplicate input writes one object; every write is a full PUT, which restarts the lifecycle age.
- Marker unchanged on the wire (`__lw_stored_object: { id, sizeBytes, sha256, preview, offloadFailed? }`);
  new markers set `id` to the sha256 hex. The reader derives the key from `marker.sha256` (or a 64-hex
  `id`), never from a stored location.
- Delete `EVAL_INPUTS_STORED_OBJECT_PURPOSE`; drop `evaluation_inputs` from `LEGACY_PURPOSE_AUDIENCE` once
  D5's cleanup has run (stored-object owns that file).
- Local filesystem and unconfirmed Azure: refuse, emit the `offloadFailed` preview marker (rule 5).

### 3.2 Group-queue S3 tier (packages/group-queue)

- Key: `group-queue/<projectId>/<hash>` (mint stays `(projectId, hash)`-derived; ADR-029's tenant check
  unchanged). Unconditional PUT on every stage so a deduplicated re-stage refreshes the object's age.
- A blob missing on decode already completes the slot fail-safe ("recoverable via replay",
  `payload-store-blob-hardening.feature:66`); D4 decides whether parked groups need longer.

### 3.3 Read fallback for existing objects

- Evaluation inputs: on a miss at the new key, read `<projectId>/<marker.sha256>` (main's key) from the same
  project destination. No `stored_objects` row and no StoredObjectApi edge are needed: the address is a pure
  function of the marker. Branch-era markers (`id` = sha256(evaluationId), key
  `<projectId>/evaluation-inputs/<id>.json`) exist only on development stacks; read them too for one release
  or drop them (D6).
- Group-queue: on a miss at the new key, read `<projectId>/<hash>` for one release (jobs in flight at deploy).
  After one lease horizon nothing references the old keys.
- Both legacy reads carry a removal note naming the release after which they go.

### 3.4 What gets deleted

- Code: `EVAL_INPUTS_STORED_OBJECT_PURPOSE`; the branch-era evaluation key layout; the unused
  `PayloadStagingRepository`, `S3PayloadStagingRepository` and `PayloadStagingUnavailableError` in
  stored-object (Q217(5)); the legacy reads after their release.
- Data (D5): main-era `stored_objects` rows with purpose `evaluation_inputs` and their bytes at
  `<projectId>/<sha256>`; main-era group-queue objects at `<projectId>/<hash>`. Neither prefix can carry a
  lifecycle rule, so they go by a one-shot task or stay until project deletion.
- ADR-040 (durable stored-object offload for evaluation inputs) is superseded by a new ADR recording this
  ruling; ADR-029's "durable-tier sweep" sentence is corrected.

## 4. Scenario rewrites

`specs/evaluations/evaluation-payload-offload.feature` (owner evaluation; move to
`modules/evaluation/specs/` in the same slice):

- "an oversized evaluation input is offloaded, not truncated": Then "stored under the evaluation-inputs
  prefix, kind first and tenant second, with no stored-object record".
- New `@unit`: "the offload key is derived from the content, never from the marker's stored location".
- New `@unit`: "a run offloaded before the move is read from its old address" (section 3.3).
- New `@unit`: "an expired offload answers its preview and warns" (rule 4).
- New `@unit`: "a destination that cannot expire objects keeps the inputs as a preview marker" (rule 5).
- "offloaded bytes are recorded for storage accounting": delete (finding 5; D7).
- "deleting the project removes its offloaded evaluation content": reword to D8's answer, or delete.
- Header comment: drop "content-addressed stored-objects service" and the `stored_objects` cascade note.

`packages/group-queue/specs/payload-store-content-addressed.feature`:

- Decision comment: key `group-queue/<projectId>/<hash>`; replace "durable-tier sweep" with "an operator
  lifecycle rule on the `group-queue/` prefix".
- New `@unit`: "the S3-tier key carries the lifecycle prefix first"; bind "A very large payload offloads to S3".
- New `@unit`: "a blob staged before the move is read from its old key".

`modules/trace/specs/large-trace-blob-offload.feature:26`: "24h lifecycle" becomes "3-day lifecycle".

`specs/langevals-staging/staged-payload.feature` and `specs/nlp-go/lambda-invoke-payload-staging.feature`:
no behaviour change; add the 3-day minimum to the lifecycle sentence.

`modules/stored-object/specs/stored-objects.feature` and `externalize-event-byte-content.feature`: no change;
stored objects keep "no automatic retention", which is now true because oversized payloads are not stored
objects.

## 5. Slices

Each slice is independently committable and leaves the tree bootable.

1. **Specs and ADR** (evaluation, group-queue, trace specs; `dev/docs/adr/`): section 4 rewrites, the new ADR
   superseding ADR-040, the ADR-029 correction. Needs D1-D8 answered.
2. **Evaluation inputs** (modules/evaluation): new key and rules constant, legacy read, refusal on
   unexpirable destinations, purpose constant deleted, scenarios bound in
   `evaluation-inputs-offload.service.unit.test.ts` and a repository test over the memory twin.
3. **Group-queue S3 tier** (packages/group-queue): prefixed mint, unconditional PUT, legacy read, bound
   scenarios. Touches the eventing hot path: run the group-queue suite against local Redis.
4. **Operator surface** (charts, `.env.example`, docs self-hosting page): one lifecycle table listing every
   prefix and minimum, and the generalised Azure confirmation (D3). Shared files; coordinator-applied.
5. **Stored-object clean-up** (modules/stored-object): delete the unused payload-staging chain (Q217(5)); the
   one-shot D5 task if chosen; drop `evaluation_inputs` from the legacy audience map after it runs.
6. **Ops comment** (modules/ops): `MONITORED_TABLES` comment no longer names evaluation inputs.

## 6. Decisions for Alex

- **D1 prefix shape.** (A, recommended) kind-first top-level prefixes, existing three unchanged, new
  `evaluation-inputs/` and `group-queue/`. (B) one root `oversized/<kind>/` for every kind, renaming the
  three existing prefixes (operators add rules; two-release dual read and delete).
- **D2 evaluation-inputs horizon.** Evaluation rows carry per-project `_retention_days` (migration 00032);
  a bucket rule cannot follow a per-project value. (a) one fixed horizon (for example 90 days, operator-set),
  preview after; (b) a retention-class segment, `evaluation-inputs/r<days>/<projectId>/`, one rule per class
  (a later retention change does not move objects); (c) object tags with tag-filtered rules (S3 and Azure
  only, not GCS-compatible stores).
- **D3 Azure and filesystem.** Generalise the spool's confirmation to one `objectRetentionConfirmed` flag
  covering every prefix, or one flag per prefix? Filesystem: refuse every oversized write (as the spool does),
  or an in-app sweeper for file destinations only?
- **D4 group-queue horizon vs parked groups.** A group parked or dead-lettered longer than the lifecycle loses
  its blob and completes fail-safe. Accept (replay recovers), or size the rule to the longest park?
- **D5 main-era data.** (a) a one-shot task copies `evaluation_inputs` objects to the new prefix, then
  deletes the old bytes and rows (stored-object owns the rows; evaluation owns the new key: needs a task
  shape that does not add an edge); (b) leave them, keep the legacy read until project deletion removes
  them; (c) leave the bytes, delete only the rows (they then never get deleted).
- **D6 branch-era evaluation markers**: read them for one release, or drop them as development-only?
- **D7 storage accounting**: delete the scenario (main never surfaced it), or keep a per-kind byte counter?
- **D8 project deletion.** With no row, offloaded evaluation inputs survive project deletion until the
  lifecycle rule. (a) accept and document "removed within the horizon"; (b) give the `objectStorage` client a
  prefix delete (framework change) and have each owner delete `<kind>/<projectId>/` on project deletion
  (needs a project-deleted fact the owners subscribe to; none exists today).
