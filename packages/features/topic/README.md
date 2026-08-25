# Topic

The Topic feature owns the projected topic model and the read surface for
topic-clustering status and history. The clustering process, projections and
worker composition remain process-owned until the physical application split;
they will consume the same `TopicService` rather than introducing another
topic repository.

`contract` contains portable Zod 4 schemas and the abstract service
capability. `server` contains the private Prisma repository and its service
implementation. No caller imports the repository or Prisma rows.
