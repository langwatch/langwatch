# Topic service boundary

## Decision

Topic clustering has one product capability: `TopicService`. Its contract
owns topic DTOs, clustering status, and bounded run history. The server
implementation owns one private repository that reads the projected Topic,
run-status, and run-history rows. Eventing supplies the next durable wake
through an injected scheduling port; Topic does not read Eventing's store.

The worker and event-sourcing pipeline remain application-owned for now. They
write the projections and schedule work, but they do not expose repositories
to API callers. A later composition change will inject this service into the
single application graph.

All database rows and JSON read models are parsed at the repository boundary
with the feature's Zod 4 schemas. Missing collections return empty arrays.
There is no second Topic or Topic Clustering service.
