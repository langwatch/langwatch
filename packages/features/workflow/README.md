# Workflow

Workflow owns workflow definitions, graph versions, the portable Studio DSL,
and its migration history.

- `contract/` exposes portable Zod 4 workflow values, `StudioWorkflow`, DSL
  migration, and service capability.
- `server/` owns persistence, versioning, restore, copy, and dispatch ports.
- `web/` owns browser graph utilities, the Zustand workflow store, and small
  browser hooks. It imports the contract; it does not define persisted values.

The application remains responsible for page shells, tRPC/REST query and event
composition, execution transports, Monaco/editor chrome, and Lambda/worker
infrastructure. It consumes the `web` package and the canonical server service
through the runtime composition root.
