# Topic

The Topic feature owns the projected topic model, the topic-clustering
eventing pipeline, and the read surface for clustering status and history.
The process-owned application graph exposes one `app.topics` service; there
is no second read service.

`contract` contains portable Zod 4 schemas, the abstract service capability,
and the clustering event/command taxonomy (type strings, versions, enums,
event data schemas) — no eventing or server dependencies. `server` contains
the private Prisma repository, the service implementation, and the
topic-clustering-processing pipeline: event envelopes, commands, fold
projections, the `topicClustering` process manager, and its run intent
executor (`adapters/eventing.topic-clustering.adapter.ts`). Pipeline
registration, the clustering execution, boot seeds, and the Prisma
projection stores remain app composition (a named residual). Malformed
history JSON is treated as an empty rebuildable history, and topic lists
preserve database order. No caller imports the repository or Prisma rows.

Specs live in `specs/` (event-sourced scheduling, run history, topics source
of truth, trace assignment, read surface).
