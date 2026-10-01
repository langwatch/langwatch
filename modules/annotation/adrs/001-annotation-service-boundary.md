# ADR-001: Annotation exposes one callable app

**Status:** Accepted; implementation in progress

**Behavioural contract:** [Annotation service](../specs/annotation-service.feature)

**Shared architecture:** [ADR-133](../../../../dev/docs/adr/133-composition-spec.md)

## Context

Annotation comments, scores, queues and queue items belong to one product
feature. Their persistence and workflows previously leaked into process
composition and transports. Splitting those tables into separate features would
preserve that fragmentation instead of fixing ownership.

## Decision

The contract publishes portable schemas, handled errors and one callable
`AnnotationApi` interface with its runtime token. `AnnotationApp` implements
that interface and owns three private services:

| Service                  | Responsibility                                                                  |
| ------------------------ | ------------------------------------------------------------------------------- |
| `AnnotationService`      | Comment and anchor mapping, persistence and entity errors                       |
| `AnnotationScoreService` | Score definitions                                                               |
| `AnnotationQueueService` | Queue configuration and lookup, assignments, reach, completion and page queries |

The app coordinates services and peer APIs for user enrichment, reference
validation, review pages, suggestions and trace effects. Services receive only
their entity repositories; they do not fetch users or orchestrate peer features.
Neither services nor repositories are
public app fields. Other features receive `AnnotationApi`, never an annotation
repository or an internal service. Complete peer APIs provide project ownership,
organization membership, users, trace operations and authorization decisions.

## Dependencies

Only the app consumes complete Project, Organization, User, Trace and Authz APIs
from their contracts. Entity services receive repository interfaces. The web
surface reads shared session, active scope and permissions from the UI host;
the application owns their query and navigation lifecycles.

## Persistence

Repository contracts are interfaces. The annotation and score services each
receive one repository. The queue service receives both queue and queue-item
repositories: repository count does not determine service count. Generated
Prisma types remain in the Prisma
implementations. `AnnotationApp.create` receives repository interfaces and has
no knowledge of Prisma, Postgres connections or backend selection.

The feature registers one Postgres repository factory and one memory repository
factory with `defineRepositories`. Each constructs four separate repositories;
the factories contain wiring only. Tests may replace one repository while using
the other real memory implementations. Process startup selects one backend with
`.withPersistence(...)`. Boot validates every required implementation and
infrastructure dependency before construction, constructs each selected
repository once and injects the resulting repositories into the app factory.
Missing Postgres infrastructure never falls back to memory. Memory state belongs
to the installed process, never to an import-time singleton.

All annotation tables remain owned by this feature. Queue-item writes retain
transactional upserts, existing unique keys and reset-on-requeue behavior.
Prisma repositories declare their model tuples through the shared repository
base. Those tuples supply both native delegate types and runtime table claims;
the Postgres bundle derives its infrastructure requirement and claims from its
repositories. Type narrowing does not provide runtime database isolation.
Both persistence implementations preserve project isolation, ordering,
pagination and ordinary lookup errors. In-memory persistence is a functioning
implementation, not a collection of test stubs.

## Contracts and validation

Contracts contain public app, REST and tRPC inputs, outputs, schemas and errors.
Internal commands, persistence rows and intermediate models belong in the
server package. Public schema files use role names such as
`annotation.schemas.ts`, `annotation-rest.schemas.ts` and
`annotation-trpc.schemas.ts`; a storage-oriented filename does not define a
public boundary. Use `get`, `getMany`, `list`, `create`, `update` and `delete`
for the corresponding app and service operations.

Private commands are colocated with their owning service. They are not public
contract exports merely because a repository also uses them.

## Public surfaces and transports

REST and tRPC declarations use the shared API package. Each endpoint places its
name, verb, input sources, permissions, output, documentation and inline handler
together. REST uses `/api/v1/annotations`; deliberate compatibility mounts retain
existing URLs. The framework parses inputs, authorizes the exact target and
serializes responses. Handler arguments contain no raw request or response.

The web package owns controlled cards, editors, score fields and queue
presentation. The UI application supplies routing, transport hooks and actions.
Author enrichment remains behind the app and preserves full user fields for
project and queue reads, with only id, name and image on trace reads.

## Errors

Omitting output declares `void`; REST then returns HTTP 204 with no body.
Annotation deletion uses this form. Expected failures are thrown handled errors;
ordinary annotation, score and queue lookups throw a handled 404 when absent.
Peer errors such as `ProjectNotFoundError` propagate unchanged. An annotation
wrapper is unnecessary when it adds no domain meaning.
Runtime output mismatches are logged without response content and preserve the
response, as specified in ADR-133.

## Runtime and registration

The obsolete ClickHouse annotation backfill and its migration registration are
removed. Annotation declares no migration or background backfill task.

Imports and declarations perform no work. API and worker install the same app
factory, constructing services once per process. Requests never construct
services or repositories. Environment parsing and resource startup belong to
process composition.

## Environment and configuration

Annotation does not read environment variables. Process boot supplies the
selected persistence backend and its typed infrastructure. Memory selection
creates fresh process-owned state without requiring Postgres configuration.

## Preserved behavior

Reference checks precede queue name and slug checks. Queue operations retain
project filters, organization membership, actor reach, ordering, pagination,
counts and complete response fields. Queueing rejects malformed annotators,
validates references, trims and deduplicates trace IDs, and writes only traces
held by the requested project. Unresolved and repeated IDs count as skipped.

Review writes preserve suggestion updates and trace annotation markers.
Marker creation and removal are best effort after annotation persistence. A
marker failure is logged and does not turn an already committed mutation into
a failed request that callers might retry. This does not guarantee marker
delivery; guaranteed delivery would require a durable retry boundary.

Annotation IDs use KSUID with the shared `ANNOTATION_KSUID_RESOURCE` constant.
Repositories return typed domain values and validate uncertain JSON fields.
Known absence and invalid
references retain their concrete handled errors; unexpected database failures
propagate to the framework's error boundary.

## Consequences

One public app keeps workflows coherent without exposing the services or
repositories it coordinates. Separate repository interfaces allow replacing one
dependency in a test. Supporting memory and Postgres requires observable parity
checks for the same operations; type compatibility alone cannot establish it.
