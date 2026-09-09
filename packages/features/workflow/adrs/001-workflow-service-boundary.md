# ADR-001: Workflow owns definitions and dispatch-facing behaviour

**Status:** Accepted

**Behavioural contract:** [Workflow service boundary](../specs/workflow-service.feature)

## Context

Workflow definitions currently sit beside transport routers and Studio DSL
helpers. That made tRPC, REST, execution and evaluation paths able to construct
their own persistence access. Workflow is a singular lifecycle in the core
feature map.

## Decision

Workflow is a singular feature. It owns workflow definitions, graph versions,
published-version selection, DSL validation, archive/copy operations and the
execution dispatch capability. Evaluation runs remain owned by Evaluation;
`/workflows/:id/evaluate` is application API composition over both services.

`WorkflowApi.executeComponent` returns the requested component's final execution
state from the process's existing Studio dispatcher. HTTP agent tests use that
operation; Agent does not receive an engine-dispatch callback. API composition
shares the dispatcher with the Studio authoring transport. The legacy Workflow
composition still supplies that owner service to the App at boot.

## Contracts and validation

The contract uses Zod 4 schemas for portable definitions and versions. The
graph envelope is validated while node values remain open for execution-engine
compatibility.

`@langwatch/workflow-contract` owns the canonical wire `WorkflowDsl` and the
typed `StudioWorkflow` refinement. Both server and browser use its migration;
there is no second persisted schema or legacy editor `Workflow` alias.

It also owns the portable execution-event and optimizer-parameter wire shapes,
plus entry-default materialization. Unknown DSL and state fields remain intact.

## Persistence

The service receives its private Workflow repository and the canonical Dataset
service used by workflow copying. Prisma is confined to
`repositories/prisma`, and the process composes one service via
`PostgresWorkflowAdapter`.

Linked Agent operations use `WorkflowApi` for batched field discovery,
summaries, archive, copy and failed-copy cleanup. Every persistence operation
keeps the project predicate. Invalid historical graphs report unresolved fields;
valid graphs preserve their declared outputs. Cleanup clears version pointers
and parent references before deleting versions and the workflow.

Studio execution materializes referenced datasets through an explicit
`DatasetService`; it does not read a process-global application instance.

## Dependencies

The Workflow server package owns the version-to-nlpgo execution bridge and
persisted-DSL migration. Application composition supplies its explicit nlpgo,
model-provider, project-environment and LiteLLM-parameter infrastructure. The
adapter requires Dataset, environment and LLM parameter dependencies to
construct the private Studio-event preparer given to `WorkflowService`; neither
it nor the service receives Prisma or a Model Provider service directly.

## Public surfaces and transports

Existing tRPC names and REST paths remain compatibility transports. The
`/workflows/:id/evaluate` route remains an app-owned composition over Workflow
version selection and Evaluation execution.

The browser surface is `@langwatch/workflow-web`. It owns graph, field-edge,
and Studio dataset transforms; templates; the node palette and default-edge
registries; agent-node transforms; prompt, evaluator, and agent selection
state transitions; the workflow Zustand store; browser LLM-node and code-agent
helpers; controlled Workflow code and Liquid-condition editors; and small
browser hooks. The contract owns portable local-config DSL
transforms and default-node values because API dispatch uses them too. The
selection transitions receive named application drawer ports, while app page
shells, query/event transport composition, secret controls, and Lambda/worker
infrastructure remain application responsibilities. The browser package owns
the code-node Python provider behaviour used by its editor.

Workflow Web also owns the creation dialog's template selection, file import
validation and browser state. Application composition supplies the existing
create form, mutation, routing and error presentation through controlled render
ports.

Workflow Web owns workflow-card presentation and its copy, sync, push and
delete action menu. Application composition supplies project queries,
mutations, toasts and replication dialogs.

The Studio results panel shell, empty/error states and selected-run browser
state are Workflow Web presentation. The application composes Experiment Web's
run sidebar, table and footer with its project-scoped result queries.

## Runtime and registration

The process creates one `PostgresWorkflowAdapter` during App composition and
passes its resulting `WorkflowService` through request context. The same
composition connects the Workflow server executor to nlpgo and model-provider
infrastructure. Its required dependencies are the private database adapter,
canonical `DatasetService`, project-environment and LiteLLM-parameter ports,
plus the required execution port.

## Environment and configuration

The feature does not read environment variables. Configuration is validated by
the application boot layer and supplied through the injected ports.

## Errors

Service reads return a value or throw concrete errors such as
`WorkflowNotFoundError`, `WorkflowVersionNotFoundError` and
`WorkflowNotPublishedError`. Nullable repository lookups never cross the
service boundary.

## Consequences

Workflow computes scenario mapping defaults when a graph is saved. It reads and
updates linked Agent configs through the complete `AgentApi`; Agent owns the
project/workflow-scoped persistence. Refresh preserves valid custom mappings and
unrelated config fields. Refresh failures are logged without failing the saved
workflow version.

Workflow behaviour has one implementation shared by transports and workers;
Prisma and infrastructure remain at the composition edge. Existing transports
can migrate independently without changing URLs or tRPC procedure names.
