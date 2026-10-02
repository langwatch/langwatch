# ADR-001: One Dataset service boundary

**Status:** Accepted

**Behavioural contract:** [Dataset service](../specs/dataset-service.feature)

## Context

Dataset behaviour is currently spread over the Dataset and Dataset Record tRPC
routers, the public dataset REST API, and a loose server folder. The same durable
Dataset lifecycle is therefore easy to construct repeatedly and difficult to
share with workers or later RPC transports. Dataset records, imports, and S3
JSONL are Dataset implementation details; they are not separate features.

## Decision

Dataset exposes one `DatasetApi` token in its contract and one process-owned
implementation, `DatasetModule`. Existing tRPC procedure names and REST paths keep their exact
shape and delegate to that service. Callers consume only
`@langwatch/dataset-contract`.

The first strict package slice owns dataset metadata and record lifecycle:
create/update, name and slug policy, lookup, archive, copy, paginated reads,
record creation/update/deletion, and the portable error vocabulary. Upload
normalization and S3 JSONL chunk mutation are Dataset services too
(`DatasetNormalizeService`, the chunk services); there is no second Dataset
implementation outside the module.

### Public surfaces and transports

The contract exports Dataset and Dataset Record values, Zod 4 schemas, domain
errors, the `DatasetApi` token and the tRPC declarations. The process package
installs `DatasetModule`, its repositories, the normalization pipeline and the
REST and tRPC transports through `defineProcessModule("dataset")`.

The `dataset.*`, `datasetRecord.*` and `batchRecord.*` tRPC surfaces are
declared in the contract and served from `process/src/transport/`. Each
declaration owns its procedure names, input schemas and permission; the
framework supplies authentication, authorization, audit, tracing and logging.

The policy is applied by the feature AFTER its own `.input()` parser, never
composed ahead of it: tRPC appends the input middleware where `.input()` is
called, so a check installed earlier receives `input === undefined` and the
authorization decision, the scope-lineage guard and the audit row all see
nothing while still reporting success.

Dataset also owns trace-to-record mapping state, default evaluator input mappings,
legacy mapping conversion, and the prior-evaluation source predicate. Evaluator
definitions remain independent of Dataset; Evaluation execution and Evaluator UI
import mapping helpers directly from Dataset.

### Dependencies

Dataset depends on no other product service for the core lifecycle. Storage
(Postgres and the object store) is reached through Dataset's own repositories.

Two capabilities Dataset needs are NOT Dataset's, and each is reached through
its owner's Api token rather than imported:

- an experiment lookup (`ExperimentApi`), so `dataset.upsert` can borrow an
  experiment's name and `batchRecord.getAllByexperimentSlug` can turn a slug
  into an id;
- a project-permission check (`AuthzApi`), because `dataset.copy` names a
  SECOND project, the source, that the declared check on `projectId` never
  covers.

The two `BatchEvaluation` reads behind `batchRecord.*` go through Dataset's
`batchEvaluations` repository.

Upload normalization runs as the `datasetNormalize` command on Dataset's
command-only `dataset_normalization` pipeline, handled by
`DatasetNormalizeService`. Its durable payload has a contract Zod schema and is
parsed before normalization work begins.

### Persistence

The services receive only Dataset's repositories and the peer Api tokens
above. Prisma is private to `process/src/repositories/prisma`; those
repositories map generated rows to Zod 4 contract values. Storage, queue,
object-store, and experiment behaviour are injected rather than imported
globals.

### Runtime and registration

The process container installs one `DatasetModule` behind `DatasetApi`. REST
and tRPC handlers reuse that instance; they do not construct the module,
resolve Prisma, or build repositories per request.

The module's eventing registers the `dataset_normalization` pipeline; the
worker consumes its commands.

### Environment and configuration

The feature reads no environment variables. Runtime configuration and concrete
database, object-store, and queue clients are supplied by the process container.

### Errors

The service throws Dataset contract errors for missing, conflicting, not-ready,
and missing-record cases. Transports map those errors once; Prisma errors do
not cross the package boundary.

### Contracts and validation

All service inputs and returned values are defined by Zod 4 schemas in the
contract package. The service parses its inputs at the boundary and repositories
map persistence rows into the same portable schemas.

## Consequences

Dataset and Dataset Record have one owner, transport included, while all
existing public URLs and internal tRPC names, inputs, outputs, error codes and
permissions remain stable. Persistence records never become part of a
cross-module API, and upload and S3 work live in Dataset's services rather
than in a second transport-owned implementation.
