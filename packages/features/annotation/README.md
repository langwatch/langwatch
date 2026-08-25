# Annotation

Annotation owns the portable annotation record, anchor vocabulary, handled
errors, one abstract `AnnotationService`, and reusable browser presentation.
Its server package owns the private Prisma repository and PostgreSQL
composition adapter; its web package owns cards, editor bodies, diffs and
score controls.

## Journey

1. The process composes one PostgreSQL annotation service at startup.
2. A transport calls the contract service for validated writes, tenant-scoped
   reads, projection reads, or queue-reference checks.
3. The private repository preserves Prisma ordering and maps every row through
   the contract schema before returning it.

tRPC/REST URLs, permission checks, ClickHouse side effects, trace enrichment,
and queue/score workflows remain application transport seams. The application
also composes tRPC queries, mutations, draft stores and trace navigation into
the web components through narrow props and callbacks. Process presets inject
one annotation service; requests do not construct repositories or services.

See [ADR-001](./adrs/001-annotation-service-boundary.md) and the
[service contract](./specs/annotation-service.feature). Browser journeys live
in the [queue workflow](./specs/annotation-queue-workflow.feature) and
[annotation list](./specs/annotations-list-selection.feature) specifications.
