# Data Privacy service boundary

**Status:** Accepted

**Behavioural contract:** [Data Privacy service](../specs/data-privacy-service.feature)

## Context

Capture policy decided what a customer's traces keep, and it was answered in
three places at once: the settings transport, the ingestion redaction path and
the read-visibility helpers. Each held its own reading of the scope cascade, so
the same project could be redacted one way on ingestion and displayed another
way on read.

## Decision

`data-privacy` owns the scoped capture policy, its cascade resolution, read
visibility helpers, validation, cache and `DataPrivacyPolicy` persistence.
The contract package contains only portable Zod 4 schemas, DTOs, errors and
pure resolution/visibility functions. The server package contains one concrete
service, a private abstract repository port, a Prisma composition adapter and
an internal cache. The public server root exports only the composition adapter;
callers never receive the repository, cache or concrete service as package
surface.

The repository reads and writes only `DataPrivacyPolicy` rows. Project and team
ownership comes from the canonical `ProjectService` and `OrganizationService`
injected into the service. The project service currently supplies the project
department id; resolving a personal project's department from organization
membership, and validating department-scope writes, waits for a canonical
department capability. Department writes and removals therefore fail clearly
until that capability exists rather than querying foreign tables from this
repository or trusting an unverified organization id.

Persisted policy rows are parsed with the contract schemas. Invalid durable
configuration is an error and is never silently dropped from a resolution or
list result.

Routes, trace ingestion, redaction engines and settings UI are adapters. They
must call the composed `DataPrivacyService`; they must not create a second
policy repository or service. Redaction implementation extraction is a later
slice because it has ingestion and trace-pipeline ownership concerns.

The policy cascade is project, department, team, then organization, with
personal-only variants for personal projects. Scalar policy fields use the
nearest rule; custom patterns union from matching scopes. Missing policy uses
the platform default: captured content, essential PII and secret redaction.

## Public surfaces and transports

The contract publishes the policy schemas, the cascade resolution and read
visibility functions, the errors, and the abstract `DataPrivacyService`. The
server package publishes only its composition adapter. Data Privacy mounts no
route. Trace ingestion is its one production caller today: it reaches the
composed service through the process trace privacy runtime, which drives span
redaction and content dropping. The published read visibility functions have no
caller yet, and the `dataPrivacy` settings procedures still read the
application's own policy modules. Both are residuals of this move, not second
owners the decision endorses.

## Dependencies

The contract depends on the shared redaction package and Zod. The server depends
on that contract, on the Project and Organization contracts for project and team
ownership, on the shared redaction package for its over-broad pattern probe, on
a safe regular expression analyser, and on the generated Prisma client.

## Persistence

One private Prisma repository reads and writes `DataPrivacyPolicy` rows and
nothing else. Ownership facts it needs about a project or a team come from the
canonical Project and Organization services rather than from a foreign table.

## Runtime and registration

Process composition builds one service from the Prisma client and those two
canonical services, then injects it into the trace privacy runtime that the
ingestion pipeline uses. The feature registers no worker job, subscriber or
event pipeline of its own, so it runs in whichever process composes ingestion
and reads.

## Environment and configuration

Data Privacy packages read no environment value. The cache lifetime and the
clock are optional constructor arguments with in-package defaults, and every
other collaborator is supplied at composition.

## Errors

A scope whose target does not exist throws a scope-target error, and a
department scope that cannot yet be resolved to an owner throws its own error
rather than guessing. A rejected configuration throws an invalid-configuration
error, which also covers a custom pattern that does not compile, one the safe
analyser rejects, and one the shared probe reports as too broad to be a secret
rule. All three are concrete errors rather than handled ones, so a composing
transport maps them to its own response.

## Contracts and validation

Zod 4 schemas define the stored policy and every input. Persisted rows are
parsed on the way out, so durable configuration that no longer validates is an
error rather than a value silently dropped from a resolution or a list. Patterns
are vetted at write time because the ingestion path evaluates them per event.

## Consequences

Ingestion resolves capture policy through one owner, and the read visibility
rules it will share are published beside it rather than re-derived. Department
writes fail clearly while no canonical department capability exists, which is
visible rather than a quiet wrong answer. The settings transport and the
redaction engines are still application code, so until those slices land the
settings surface can disagree with the composed service; that is the residual
this decision accepts, not a second owner it blesses.
