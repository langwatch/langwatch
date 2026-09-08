# Annotation

Annotation owns the portable annotation record, anchor vocabulary, handled
errors, one callable `AnnotationApi`, and reusable browser presentation.
Its server package owns separate repository interfaces and Postgres and memory
implementations; its web package owns cards, editor bodies, diffs and
score controls.

## Journey

1. The feature installer constructs one app per process, with private comment,
   score and queue services. The queue service owns two repositories. Startup selects the registered Postgres
   or memory repositories; the app receives repository interfaces.
2. A transport calls the contract API for validated writes, tenant-scoped
   reads, projection reads, or queue-reference checks.
3. The private repository preserves ordering, maps persistence values and
   validates uncertain JSON fields before returning domain values.

The app coordinates user and trace enrichment, review effects and queue
workflows. REST and tRPC use the shared API framework for parsing, exact-target
authorization and responses. The UI application composes queries, mutations,
draft stores and trace navigation into
the web components through narrow props and callbacks. Process presets install
one annotation app; requests do not construct repositories or services.

See [ADR-001](./adrs/001-annotation-service-boundary.md) and the
[service contract](./specs/annotation-service.feature). Browser journeys live
in the [queue workflow](./specs/annotation-queue-workflow.feature) and
[annotation list](./specs/annotations-list-selection.feature) specifications.
