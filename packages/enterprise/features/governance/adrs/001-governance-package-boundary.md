# ADR-001: Governance owns the Enterprise AI control plane

**Status:** Accepted

**Behavioural contract:** [Enterprise governance](../specs/governance.feature)

## Context

Governance is LangWatch's Enterprise AI control plane: it decides, records and
enforces how an organisation's AI systems are used. Its UI, ingestion sources,
provider pullers, attribution policy, departmental views, budget enforcement,
anomaly rules, audit facts and transport handlers grew together below an
application alias. That made the application itself the only place the product
vertical could be composed.

## Decision

Create portable governance contracts and separate server and web packages.
Governance owns ingestion and normalisation, organisational attribution,
governance policy and enforcement, governance anomalies and audit facts, and
the operator surfaces that expose those decisions. It also owns the pure
persona-home policy that chooses between Governance and project homes from
organisation intent and Governance setup state; the application still owns
authentication, signal loading and the redirect transport. The ingestion-pull and
pulled-usage workflows therefore belong to governance rather than to a generic
Enterprise event-sourcing directory. Governance also owns quarantine-fill rate
and warning policy; project resolution and trace-activity storage remain
injected capabilities.

Gateway, Billing, Webhooks, Automations and the generic Audit Log retain their
technical capabilities. Governance consumes gateway spend facts, delegates
metering and invoicing, emits webhook delivery intents, delegates generic
trigger execution and writes through audit capabilities using narrow ports. It
does not absorb those features' transports, persistence engines or reusable
frameworks.

`feature.json` declares the accepted source subjects for this deliberately
broad bounded context. A new subject must update that manifest, this ADR and
the linked feature specification together; architecture lint rejects an
undeclared source subject.

## Public surfaces and transports

Each package exports only its root. Contracts describe facts and capabilities;
REST, RPC, tRPC, Eventing, and browser code are adapters or consumers.

## Dependencies

The contract uses Zod 4 and Croner. It imports no application, server,
database, request-framework, or Eventing runtime type.

Anomaly-rule validation and lifecycle belong to the Governance contract and
server service. The application router owns authentication and tRPC only;
Postgres access stays in the feature's private Prisma repository.
Governance also owns alert fan-out, bounded retries, signing and delivery
outcomes. The application injects its SSRF-safe HTTP adapter.
Spend-spike orchestration consumes structured spend filters through a narrow
port; ClickHouse query syntax remains inside the application adapter.

## Persistence

Server persistence is accessed through narrow class ports. Generated Prisma
types may occur only inside strict `server/src/repositories/prisma/**` adapters.

## Runtime and registration

Services, projections, and adapters are classes constructed by composition
roots. Importing a governance package does not register a worker or timer.

## Environment and configuration

Credentials, environment values, clocks, metrics, and provider clients are
injected at server construction boundaries.

## Errors

Transport-safe validation errors remain handled domain errors. Provider
failures are reported through outcome ports after the configured retry budget.

## Contracts and validation

Commands, events, schedules, source types, and pulled-usage money facts use
Zod 4 schemas and inferred portable types. No generated or server type is
reachable from the contract root.

## Consequences

API and worker runtimes can share one governance model. Eventing registration
remains a composition concern and must use the same contract facts once its
schema boundary consumes Standard Schema/Zod 4.
