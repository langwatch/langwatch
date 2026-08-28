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
implementation. Existing tRPC procedure names and REST paths remain
compatibility transports and delegate to that service while migration is in
progress. Callers consume only `@langwatch/dataset-contract`.

The first strict package slice owns dataset metadata and record lifecycle:
create/update, name and slug policy, lookup, archive, copy, paginated reads,
record creation/update/deletion, and the portable error vocabulary. Upload
normalization and S3 JSONL chunk mutation remain behind an application adapter
until their storage and queue capabilities are represented by narrow Dataset
ports. That adapter is not a second Dataset service.

### Public surfaces and transports

The contract exports Dataset and Dataset Record values, Zod 4 schemas, domain
errors, and `DatasetService`. The server exports the service and its Postgres
composition adapter. Existing tRPC names and REST paths remain compatibility
surfaces and are not duplicated inside the feature package.

### Dependencies

Dataset depends on no other product service for the core lifecycle. Experiment
name resolution is an optional `DatasetExperimentPort`; future storage and
normalization capabilities will be narrow ports owned by Dataset.

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

Dataset and Dataset Record have one owner, while all existing public URLs and
internal tRPC names remain stable. The package can be adopted by the process
graph without making persistence records part of a cross-feature API. Upload
and S3 work have a clear next seam instead of being copied into a second
transport-owned implementation.
