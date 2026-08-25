# Topic

The Topic feature owns the projected topic model and the read surface for
topic-clustering status and history. The process-owned application graph
exposes one `app.topics` service; commands, process logic, projections and
worker composition remain app-owned without a second read service.

`contract` contains portable Zod 4 schemas and the abstract service
capability. `server` contains the private Prisma repository and its service
implementation. Malformed history JSON is treated as an empty rebuildable
history, and topic lists preserve database order. No caller imports the
repository or Prisma rows.
