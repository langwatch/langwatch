# ADR-001: Agent owns reusable agent definitions and editors

**Status:** Accepted

**Behavioural contract:** [Agent package boundary](../specs/package-boundary.feature)

## Context

Agent definitions, validation, persistence and browser editors were previously
spread across application server, component and Optimization Studio folders.
Transports constructed the same behaviour in several ways, while browser code
depended on app server and Studio types.

Agent is distinct from Coding Agent. Agent owns authored code, workflow, HTTP
and compatibility signature definitions. Coding Agent owns observed coding
sessions, projections and pull-request usage.

## Decision

`agent` has contract, server and web surfaces. The contract owns portable Zod 4
schemas, values, errors and the single abstract `AgentService`. The server owns
one process-created implementation and private persistence. The web package
owns reusable agent presentation and browser behaviour, including HTTP request
configuration and testing.

## Public surfaces and transports

Existing tRPC procedure names and `/api/agents` REST paths remain compatibility
transports over the same process-owned service. REST remains deprecated but
operational. Transports retain authentication, authorisation, HTTP status and
wire-shape mapping; they do not own Agent behaviour or persistence.

## Dependencies

Agent server consumes full feature contracts for cross-feature work. Workflow
copy/archive behaviour and audit delivery are injected at composition. It does
not import another feature's server implementation or repository.

Agent web consumes the Agent contract and design system. Application UI supplies
current-project data/actions and small render ports for cross-feature Scenario
mapping and Variables presentation. It does not receive tRPC hooks or a hidden
application context.

Its private browser implementation uses the governed two-scope web layout.
`model/agent-browser.port.ts` and the development-tunnel model are genuine
package-wide portable collaborators; all other browser work is owned by named
`management`, `history`, `editor`, or `http` private features. Their UI uses
elements, blocks, and sections by responsibility: sections coordinate the
editor and management flows, blocks compose visual elements, and elements use
only model and the Design System. The public Agent Management screen and
browser-port surface retain their exact subpaths. Private features declare any
cross-feature dependency in `feature.json`; Agent currently has none.

## Persistence

Generated Prisma remains private to the Agent Prisma repository adapter. The
repository returns contract values, and no generated type appears in a public
declaration. Other features read Agent data through `AgentService` rather than
the repository.

## Runtime and registration

Each process creates one Agent service. Hono uses `context.app.agents`, tRPC uses
`ctx.app.agents`, and workers receive the service explicitly. Importing an Agent
package performs no registration and no request handler constructs a service.

## Environment and configuration

Agent packages read no environment modules. Boot composition validates runtime
configuration and injects semantic values or technical adapters when required.

## Errors

Required reads return an Agent or throw a concrete Agent domain error. Optional
discovery is exposed only through explicitly named `try*` methods. Transports map
those errors once without exposing Prisma failures.

## Contracts and validation

Zod 4 schemas define Agent configs, commands, queries and JSON boundaries.
HTTP editor state uses the same HTTP config schema as server persistence. The
editor preserves request headers, rendered-body diagnostics, stable test result
fields, stored scenario mappings and default mapping behaviour.

## Consequences

Agent has one definition and persistence owner and one reusable browser owner.
The package now owns the Agent Management screen, card, history drawer, HTTP
editor, browser port, and their package tests. The platform host supplies route,
project, RPC, dialog, toast, drawer, navigation, and cross-feature render
composition; its integration test covers the observable editor/history/copy/
push wiring and the real generic dialogs.

The extraction is not complete. `platform/app/src/components/agents` still owns
Agent UI behaviour in `AgentListDrawer`, `AgentCodeEditorDrawer`,
`AgentWorkflowEditorDrawer`, `AgentWorkflowTargetEditorDrawer`,
`WorkflowSelectorDrawer`, and `AgentTypeSelectorDrawer`, together with their
drawer URL adapters and workflow-target data helper. These are explicit next
vertical slices, not compatibility-only composition. The retained code may use
the package's narrow screen or browser-port entry while it moves, but it must
not be described as presentation-free or as a completed Agent web migration.
