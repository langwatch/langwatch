# Workflow

Workflow owns workflow definitions, graph versions, the portable Studio DSL,
and its migration history.

- `contract/` exposes portable Zod 4 workflow values, `StudioWorkflow`, DSL
  migration, entry-default materialization, execution event schemas, optimizer
  parameters, and service capability.
- `server/` owns persistence, versioning, restore, copy, dispatch ports, and
  explicit DatasetService-backed Studio dataset materialization.
- `web/` owns browser graph utilities, field/edge mapping, Studio templates,
  the node palette registry, agent-node transforms, the Zustand workflow store,
  and small browser hooks. It imports the contract; it does not define persisted
  values.

The application remains responsible for page shells, tRPC/REST query and event
composition, execution transports, Monaco/editor chrome, and Lambda/worker
infrastructure. It consumes the `web` package and the canonical server service
through the runtime composition root.
