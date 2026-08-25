# Topic service boundary

## Decision

Topic clustering has one product capability: `TopicService`. Its contract
owns topic DTOs, clustering status, and bounded run history. The server
implementation owns one private repository that reads the projected Topic,
run-status, and run-history rows. Eventing supplies the next durable wake
through an injected scheduling port; Topic does not import Eventing or its persistence adapter.

The worker and event-sourcing pipeline remain application-owned for now. They
write the projections and schedule work, but they do not expose repositories
to API callers. The single process-owned application graph exposes this
capability as `app.topics`; commands, process logic and projections remain
app-owned.

All database rows and JSON read models are parsed at the repository boundary
with the feature's Zod 4 schemas. Missing collections and malformed history
JSON return empty arrays, allowing the rebuildable history projection to
recover. Topic list order remains the database's order.
There is no second Topic or Topic Clustering service.
