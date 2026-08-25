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

Studio execution materializes referenced datasets through an explicit
`DatasetService`; it does not read a process-global application instance.

## Dependencies

NLP execution and persisted-DSL migration are explicit ports supplied by the
application composition root. A cross-feature dependency is added only when
Workflow actually calls that service; speculative Model Provider and Agent
dependencies are not part of the constructor.

## Public surfaces and transports

Existing tRPC names and REST paths remain compatibility transports. The
`/workflows/:id/evaluate` route remains an app-owned composition over Workflow
version selection and Evaluation execution.

The browser surface is `@langwatch/workflow-web`. It owns graph, field-edge,
and Studio dataset transforms; templates; the node palette registry;
agent-node transforms; the workflow Zustand store; and small browser hooks.
App page shells, query/event transport composition, Monaco editor chrome, and
Lambda/worker infrastructure remain application responsibilities. The browser
package owns the code-node Python provider behaviour used by that chrome.

## Runtime and registration

The process creates one `PostgresWorkflowAdapter` during App composition and
passes its resulting `WorkflowService` through request context. The adapter
constructor obligations are `database`, the optional canonical `datasets`
service when copies may include datasets, plus the DSL migration and execution
ports.

## Environment and configuration

The feature does not read environment variables. Configuration is validated by
the application boot layer and supplied through the injected ports.

## Errors

Service reads return a value or throw concrete errors such as
`WorkflowNotFoundError`, `WorkflowVersionNotFoundError` and
`WorkflowNotPublishedError`. Nullable repository lookups never cross the
service boundary.

## Consequences

Workflow behaviour has one implementation shared by transports and workers;
Prisma and infrastructure remain at the composition edge. Existing transports
can migrate independently without changing URLs or tRPC procedure names.
