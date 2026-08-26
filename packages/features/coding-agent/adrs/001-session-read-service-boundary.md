# ADR-001: Coding Agent has one session-read service

**Status:** Accepted

**Behavioural contract:**
[Coding-agent session reads](../specs/coding-agent-session-read.feature)

## Context

Coding Agent session reads, pull-request usage and event projections had been
split between application services and ClickHouse repositories. That exposed
private persistence to callers and let GitHub installation backfill compose a
second session reader.

## Decision

The singular Coding Agent feature owns the durable session aggregate,
trace-to-session mapping, metric overlay, ordered events and pull-request
usage. Its contract exposes exactly one `CodingAgentService`; the server's
private collaborators divide session reads, pull-request reads, attribution,
aggregation and bounded mapping backfill without becoming public capabilities.

### Public surfaces and transports

The contract exports portable Zod schemas, values, errors, telemetry
classification, transcript derivation and `CodingAgentService`. The server
exports only process composition adapters, nominal ports and the named trace
pull-request adapter. REST, tRPC, traces, eventing and GitHub setup remain
application transports or composition and delegate to the composed service.

### Dependencies

The concrete service owns private Coding Agent repositories and receives
complete `GithubService` and `ProjectService`, a nominal billing-policy port,
a nominal clock port and typed ClickHouse/retention configuration. It imports
neither another feature's repository nor Enterprise implementation.

### Persistence

The server package owns the four concrete ClickHouse repositories for session,
trace-session, metric-series and session-event rows. The named projection
persistence adapter is package-created, so application composition cannot
inject or expose those repositories. Existing tables, retention and query
semantics remain unchanged.

### Runtime and registration

`CodingAgentRuntime.create` builds one service graph at process boot. Hono,
tRPC, traces and eventing reuse it; request handlers do not construct services.
After an installation is recorded, the setup transport starts the service's
bounded backfill without awaiting the redirect and contains failures as
warnings. Importing the feature registers no routes, workers or subscribers.

### Environment and configuration

The feature reads no environment values. The app injects retention and
ClickHouse capability as typed configuration. Repository-host normalisation is
owned by the injected `GithubService`; Coding Agent receives no duplicate host
setting.

### Errors

Required reads return values or throw concrete contract errors. Optional
trace/session discovery uses `tryGet*` and returns `null`. GitHub enrichment
and installation backfill preserve their existing best-effort, warning-only
behaviour.

### Contracts and validation

All service inputs and output values are defined by contract Zod schemas. The
service validates inputs before reads; repositories map persistence rows to
portable values. The public response fields, page bounds, time windows,
ordering, title-null conversion, prices and metric-only overlay behaviour stay
unchanged.

## Consequences

Coding Agent has one discoverable cross-feature service and one private
persistence lifecycle. The application retains deliberate transport and
composition files while the feature owns session behaviour and repositories.
