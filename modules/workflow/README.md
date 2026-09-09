# Workflow

Workflow owns workflow definitions, graph versions, the portable Studio DSL,
and its migration history.

- `contract/` exposes portable Zod 4 workflow values, `StudioWorkflow`, DSL
  migration, entry-default materialization, execution event schemas, optimizer
  parameters, local-config execution transforms, default LLM-node values, and
  service capability.
- `server/` owns persistence, versioning, restore, copy, dispatch ports, and
  `prepareStudioEvent`: project environment, LiteLLM parameters and
  DatasetService-backed materialization through typed ports.
- `web/` owns browser graph and Studio dataset transforms, field/edge mapping,
  templates, canvas-node renderers and palette dragging, code-node Python
  language providers, the node palette and default-edge registries,
  agent-node transforms, prompt/evaluator/agent selection state transitions,
  workflow creation template and import selection, the Zustand workflow store,
  workflow-card presentation and management actions, Studio results-panel
  browser state and presentation, browser LLM-node and code-agent helpers, and
  small browser hooks.
  It imports the contract; it does not define persisted values.

The application remains responsible for page shells, tRPC/REST query and event
composition, Experiment result queries and renderers, execution transports,
workflow mutations and replication dialogs, Monaco/editor chrome, and
Lambda/worker infrastructure. It consumes the `web` package and the canonical
server service through the runtime composition root.
