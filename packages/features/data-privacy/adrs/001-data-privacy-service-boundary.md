# Data Privacy service boundary

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
