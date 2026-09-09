# ADR-001: Agent owns definitions, execution connections and editors

**Status:** Accepted

**Behaviour:** [Package boundary](../specs/package-boundary.feature),
[linked workflows and history](../specs/linked-workflow-and-history.feature),
[instance ownership](../specs/instance-ownership.feature),
[credential discovery](../specs/credential-discovery.feature),
[HTTP test peers](../specs/http-test-peers.feature).
Shared rules: [ADR-133](../../../../dev/docs/adr/133-composition-spec.md).
Connected protocol: [ADR-128](../../../../dev/docs/adr/128-connected-agents.md).

## Context

Agent definitions, persistence, transports and editors were spread across the
application and Optimization Studio. Transport-specific construction duplicated
services, and Agent repositories read Workflow, User and AuditLog tables owned
elsewhere. An apparently complete package could still depend on the old process
graph or leave an editor's behaviour in Scenario.

Agent owns authored signature, code, workflow and HTTP definitions, plus agents
registered by an SDK. Coding Agent remains a separate feature for observed coding
sessions and usage.

## Decision

One callable `AgentApi` interface and runtime token form the peer boundary.
`AgentApp` privately owns its services and implements that interface.

## Contracts and validation

Portable configs, commands, results and handled errors live in the same contract
package. Its tRPC declaration defines browser procedure inputs and outputs; server
handlers bind permissions and behaviour through `@langwatch/api`. REST has its
own endpoint shapes and public response mapping. Browser code imports no server
router or generated Prisma declaration.

## Dependencies

`AgentApp` privately owns entity, copy, HTTP-test and
connected-agent services. Entity services validate commands and use private
repositories. The App assembles workflow fields, user summaries, audit history,
presence and actor-aware copy operations through complete peer APIs. It exposes
no service fields, repositories or lookup mechanism.

HTTP testing calls the complete `WorkflowApi.executeComponent` and
`TraceApi.recordCapturedSpan` APIs. Workflow owns engine dispatch and Trace owns
OTLP ingestion through their process-owned services.

## Errors

Required operations return a result or throw a concrete handled error. Collection
queries return collections, including an empty collection when nothing matches.
Peer errors propagate unless a distinct Agent failure adds useful meaning.
Protocol cleanup and compensating rollback retain explicit error handling.

## Persistence

The feature declares `agentRepositories` and `AgentApp` through `defineFeature`.
Process boot selects Postgres or memory. The App receives repository interfaces
and semantic config; it knows neither Prisma nor backend selection. Each repository
instance and service is constructed once in that process and belongs to its
resource scope. Tests use the same App with real memory repositories and explicit
peer fixtures.

The Prisma repository claims Agent and keeps generated Prisma types private.
Workflow owns graph queries and copying, Project owns project paths, User owns
profiles, and AuditLog owns history queries and its historical system migration.
Agent never joins their tables through its repository.

Connected identity registration converges on the project/identity unique key,
preserves the original ID and revives archived rows. The repository handles a
concurrent unique-key collision by updating that same identity; unrelated write
failures propagate. Optional config properties are omitted before JSON persistence.
Memory and Postgres preserve project isolation and archived-row semantics.

Connected instance IDs are atomically claimed for the authenticated principal
within a project. Reconnects by that principal renew the claim; competing
principals are refused before agent or presence writes. Claims outlive HTTP
sessions, pending calls and sticky pins. HTTP instance tokens are also bound to
that principal. A session cannot read or change a call for an agent it did not
register, including acknowledgement, result and delivery markers.

## Runtime and registration

API and worker compose the same App factory with real peers. Typed peer references
are allocated before construction and become callable only when the graph is
ready. A worker needs the connected runtime for dispatch and presence, but mounts
no inbound transport. Imports and constructors do not begin serving.

## Environment and configuration

Boot parses connection settings and the public platform URL, then injects semantic
config and process infrastructure. Agent packages do not read environment variables.

## Public surfaces and transports

Flat `transport/*.rest.ts` and `transport/*.trpc.ts` files keep endpoint, input,
output, permission and inline handler together. Ordinary handlers receive parsed
input, the App, actor/scope facts and declared trailing middleware facts. They
return JSON or void and throw handled errors; they cannot use a raw request,
response or headers.

The versioned `/api/v1/agents` API and deprecated `/api/agents` alias preserve
their distinct response fields, status codes and documentation. REST factories
capture the process's configured URL builder and mount the declared routers
against the composed App. tRPC descriptors are registered on the installer.
REST explicitly projects public fields: output validation is diagnostic and is
not a redaction mechanism.

WebSocket and connected long-poll lifecycle use explicit API framework protocol
integrations. Credential extraction, body limits and protocol response handling
remain there; credential services authenticate the parsed facts. Ordinary JSON
handlers cannot obtain those framework capabilities.

## Browser ownership

Agent web exposes named root entries for management and controlled editors.
Presentation lives in `ui`, browser behaviour in `behavior`, and reusable values
in `model`. Code, workflow, HTTP and connected-agent editor presentation belongs
to Agent, including onboarding and history. Tiny forwarding classes and nested
feature buckets add no boundary and are removed.

Application hosts supply routing, the typed browser client, active project,
permissions, dialogs and small cross-feature render integrations. Workflow and
Scenario retain their own mapping semantics. Loading, empty, denied and failed
reads remain distinct states. Project changes discard stale selection and editor
state; failed related-entity reads cannot enable a destructive action.

## Consequences

Package checks cover backend parity, concurrent Postgres registration, project
isolation, connected identity ownership, transport policy and exact wire fields.
Compiler tests reject invalid builder inputs and unsafe handler shapes. Browser
tests exercise the controlled editors and their real application hosts, including
save, history, copy, test execution and read failures. Moved behaviour keeps its
coverage; a passing package suite alone does not establish process readiness.
