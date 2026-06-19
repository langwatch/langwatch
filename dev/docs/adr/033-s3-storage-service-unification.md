# ADR-033: Unify S3 access behind a single object-storage service

**Date:** 2026-06-19

**Status:** Proposed

## Context

A full-repo sweep of object-storage usage shows the platform is **half-unified**:

- **Bucket + client are already unified.** There is exactly one S3 client factory
  — `createS3Client(projectId)` (`src/server/storage.ts:107`, the only
  `new S3Client` in the tree at `:158`) — and one bucket resolver,
  `resolveProjectStorageDestination(projectId)`
  (`src/server/stored-objects/project-storage-destination.ts:46`), with the
  precedence **BYOC per-org (`DATAPLANE_S3__<label>__<orgId>`) → `S3_BUCKET_NAME`
  → local FS (`LANGWATCH_LOCAL_STORAGE_PATH`)**. No consumer picks a bucket on
  its own. The canonical bucket env var is **`S3_BUCKET_NAME`** (Helm default
  `langwatch-dataset`; dev `runtime-storage-dev`).

- **The logic on top is fragmented.** Roughly five services each re-implement
  put/get/stream + key-scheme + local-FS fallback against that one client:

  | Service | Source | Key scheme |
  |---|---|---|
  | `StorageService` (legacy dataset blob) | `src/server/storage.ts` | `datasets/{proj}/{ds}` |
  | `S3DatasetStorage` / `getDatasetStorage` (chunked JSONL) | `src/server/datasets/` | `datasets/{proj}/{ds}/chunk-*.jsonl` |
  | `S3Driver` / `StoredObjectsService` (media/attachments) | `src/server/stored-objects/` | `{proj}/{sha256}` content-addressed |
  | `BlobStore` (trace/span payload spool) | `src/server/.../blob-store.service.ts` | `trace-blobs/spool/...` |
  | `stagePayloadToS3` (evaluations + optimization studio) | `src/server/langevals/`, `optimization_studio/` | `langevals-staging/...`, `studio-staging/...` |

  Each duplicates the same concerns (key construction, error mapping, local-FS
  fallback, null-byte scrub, presign). Two **different** local-FS path env vars
  exist: the legacy blob path uses `LOCAL_STORAGE_PATH` (default `<cwd>/storage`)
  while the resolver uses `LANGWATCH_LOCAL_STORAGE_PATH`
  (`/var/lib/langwatch/objects`) — they agree on S3 but diverge with no S3.

- **Deliberately separate, out of scope:** ClickHouse cold-storage/backup uses a
  *different* bucket via a *different* env var `S3_BUCKET` (note: no `_NAME`) in
  `charts/clickhouse-serverless`. The legacy `S3_BUCKET` for the app was a silent
  no-op; Helm aligned the app on `S3_BUCKET_NAME` (`_helpers.tpl:570-576`). The
  DB-stored `Organization.s3Bucket` / `Project.s3Bucket` fields are dead
  settings-UI legacy, not wired into the live path.

## Decision

We will converge all dataset/object S3 access on **one provider-pluggable
storage service interface** (the `DatasetStorage` DIP seam in
`src/server/datasets/dataset-storage.ts` is the prototype): it owns key policy,
S3-vs-local backend selection, and IO; consumers depend on the interface, never
on `createS3Client` directly.

Scope is deliberately staged:

1. **Now (this epic):** only the datasets work adopts/keeps the unified seam
   (`getDatasetStorage` → resolver → `S3_BUCKET_NAME`). We do **not** refactor
   `StoredObjects`, `BlobStore`, or the staging helpers in this PR.
2. **Backlog (incremental, later):** fold the remaining four services onto the
   seam one at a time, and retire the divergent `LOCAL_STORAGE_PATH` on the
   legacy blob path in favor of `LANGWATCH_LOCAL_STORAGE_PATH`.
3. **Never in this line of work:** the ClickHouse bucket stays separate by
   design.

**No new bucket is introduced.** Everything continues to resolve through
`resolveProjectStorageDestination` → `S3_BUCKET_NAME`.

## Rationale / Trade-offs

The expensive, risky part of "use one bucket" — bucket selection and the BYOC →
global → local precedence — is *already* solved and shared. The remaining
fragmentation is duplicated *logic*, which is real maintenance cost (five places
to fix a key bug, two local-path env vars) but is low-risk to leave in place
short-term because every path already targets the same bucket via the same
client. So we record the target and the backlog instead of a big-bang refactor:
unifying all five services now would touch traces, media, evaluations, and studio
in a dataset-scoped PR — a parc-fermé violation against the current epic's scope.

## Consequences

- **Positive:** new code reuses the seam with zero new config; the single-bucket
  guarantee is already in force; the migration backlog is explicit (4 services).
- **Negative:** until the backlog is drained, S3 logic still lives in 5 places,
  and the legacy blob path's `LOCAL_STORAGE_PATH` remains a footgun when running
  without S3 (different local root than the resolver).
- **Neutral:** the ClickHouse bucket (`S3_BUCKET`) and the dead DB `s3Bucket`
  fields stay as-is, documented here so future readers don't mistake them for the
  app path.

## Local testing against real S3

Credentials are **env-only — no code change required**. `createS3Client` reads:
`S3_BUCKET_NAME`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, and `S3_SESSION_TOKEN` (STS). Credentials are injected
into the SDK only when **both** access key and secret are present; otherwise the
SDK default provider chain is used (so `AWS_PROFILE` / IRSA works with no static
keys). Fastest dev path: `bash langwatch/scripts/refresh-dev-s3-env.sh` (writes
the three rotating SSO creds for `runtime-storage-dev` into `langwatch/.env`),
paired with `make quickstart dev-storage`.

## References

- Related ADRs: ADR-032 (datasets → S3 chunked JSONL).
- Code: `createS3Client` (`src/server/storage.ts:107`),
  `resolveProjectStorageDestination`
  (`src/server/stored-objects/project-storage-destination.ts:46`),
  `getDatasetStorage` (`src/server/datasets/dataset-storage.ts`).
