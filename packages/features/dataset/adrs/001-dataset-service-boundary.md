# ADR-001: One Dataset service boundary

**Status:** Accepted

**Behavioural contract:** [Dataset service](../specs/dataset-service.feature)

## Context

Dataset behaviour is currently spread over the Dataset and Dataset Record tRPC
routers, the public Hono dataset API, and `server/datasets`. The same durable
Dataset lifecycle is therefore easy to construct repeatedly and difficult to
share with workers or later RPC transports. Dataset records, imports, and S3
JSONL are Dataset implementation details; they are not separate features.

## Decision

Dataset exposes one portable `DatasetService` contract and one process-owned
implementation. Existing tRPC procedure names and REST paths keep their exact
shape and delegate to that service. Callers consume only
`@langwatch/dataset-contract`.

The first strict package slice owns dataset metadata and record lifecycle:
create/update, name and slug policy, lookup, archive, copy, paginated reads,
record creation/update/deletion, and the portable error vocabulary. Upload
normalization and S3 JSONL chunk mutation remain behind an application adapter
until their storage and queue capabilities are represented by narrow Dataset
ports. That adapter is not a second Dataset service.

### Public surfaces and transports

The contract exports Dataset and Dataset Record values, Zod 4 schemas, domain
errors, and `DatasetService`. The server exports the service, its Postgres
composition adapter, and the tRPC transports.

The `dataset.*`, `datasetRecord.*` and `batchRecord.*` tRPC surfaces are owned
by `server/src/api/app-trpc/`. Each is a `<Name>TrpcApi.create(root, { protected,
policy }, ports)` class that owns its procedure names, input schemas and error
mapping; the process supplies the authenticated procedure, the authorization,
audit, tracing, logging and scope-lineage policy, and the ports below. The
process keeps only a thin mount per router under
`platform/app/src/runtime/app/internal-api/`.

The policy is applied by the feature AFTER its own `.input()` parser, never
composed ahead of it: tRPC appends the input middleware where `.input()` is
called, so a check installed earlier receives `input === undefined` and the
authorization decision, the scope-lineage guard and the audit row all see
nothing while still reporting success.

### Dependencies

Dataset depends on no other product service for the core lifecycle. Future
storage and normalization capabilities will be narrow ports owned by Dataset.

Three capabilities the tRPC transports need are NOT Dataset's, and each is
declared structurally at the transport rather than imported:

- an experiment lookup, so `dataset.upsert` can borrow an experiment's name
  and `batchRecord.getAllByexperimentSlug` can turn a slug into an id;
- a project-permission probe, because `dataset.copy` names a SECOND project —
  the source — that the declared check on `projectId` never covers;
- the two `BatchEvaluation` reads behind `batchRecord.*`. That table is
  process-owned state with no feature of its own, so the reads stay in the
  process mount and the transport takes them as ports with generic result
  types. This is the one remaining seam in this vertical.

`DatasetNormalizationWorkerPort` is the Dataset-owned worker lifecycle port.
Its durable payload has a contract Zod schema and is parsed before normalization
work begins. A process composition root connects the service to the shared
Eventing sender only when that queue is registered; otherwise its existing
per-dataset inline fallback remains local to the service.

### Persistence

The service receives only its Dataset repositories and the optional
`DatasetExperimentPort` used to derive a name. Prisma is private to
`server/src/repositories/prisma`; those repositories map generated rows to
Zod 4 contract values. Storage, queue, object-store, and experiment behaviour
are injected capabilities rather than imported globals.

### Runtime and registration

The API or worker composition root constructs one Dataset service and places it
on the process-owned App. Hono and tRPC handlers reuse that instance; they do
not call `DatasetService.create`, resolve Prisma, or construct repositories per
request. The current compatibility middleware remains until its caller is
migrated to the App graph.

The Trace processing installer registers the current Dataset normalize job as
part of the shared Eventing registry. This does not enable worker consumers:
the shared queue remains producer-only until all active pipeline registrations
are present in the worker process.

### Environment and configuration

The feature reads no environment variables. Runtime configuration and concrete
database, object-store, and queue clients are supplied by the composition root.

### Errors

The service throws Dataset contract errors for missing, conflicting, not-ready,
and missing-record cases. Transports map those errors once; Prisma errors do
not cross the package boundary.

### Contracts and validation

All service inputs and returned values are defined by Zod 4 schemas in the
contract package. The service parses its inputs at the boundary and repositories
map persistence rows into the same portable schemas.

## Consequences

Dataset and Dataset Record have one owner — transport included — while all
existing public URLs and internal tRPC names, inputs, outputs, error codes and
permissions remain stable. The package can be adopted by the process
graph without making persistence records part of a cross-feature API. Upload
and S3 work have a clear next seam instead of being copied into a second
transport-owned implementation.
