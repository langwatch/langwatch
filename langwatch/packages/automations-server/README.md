# @langwatch/automations-server

The automations service layer shared by the app's two transports (tRPC and
the versioned customer API): domain services, delivery clients, dispatch
orchestration, pure event-sourcing logic, and the customer API factory.

Database-free by construction — this package consumes the repository
*interfaces* from `@langwatch/automations` and receives implementations by
injection at the app's composition root. No `@prisma/client`, no `next`,
no `react`; a dependency-guard test pins that.

- `.` — `buildAutomationsServices(deps)` composition entry + the injected
  dependency contract
- `./api` — the versioned customer API factory (built on `@langwatch/api`)
- `./services/<name>` — one domain service per module
- `./clients/<name>` — outbound edges (Slack, HTTP webhook, email port)
- `./dispatch/<name>` — effect orchestration (notify/persist classing)
- `./event-sourcing/<name>` — event/command/intent schemas + pure
  evolve/wake logic the app's pipeline mounts
- `./testing` — in-memory fakes for consumers' tests

See `dev/docs/adr/063-automations-domain-packages-customer-api-and-agent-surface.md`.
