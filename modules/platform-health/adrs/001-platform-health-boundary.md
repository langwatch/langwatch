# ADR-001: One subsystem probe, two doors

**Status:** Accepted

**Behavioural contract:** [Platform health](../specs/platform-health.feature)

## Context

The five subsystem probes lived inside the API process as Hono handlers, each
one authenticating a project API key in its own body while declaring itself a
public endpoint. An external monitor — Better Stack — was expected to hold a
tenant's key to ask a question about the platform, and the route registry
advertised five authenticated routes as open.

Two things were tangled: what a probe does, and who may ask for it.

## Decision

`platform-health` is a singular core feature. The probes themselves move into
`@langwatch/platform-health-server`, and neither door owns a copy of them.

## Public surfaces and transports

`@langwatch/platform-health-contract` and `@langwatch/platform-health-server`
are the public feature surfaces. There is no web package: nothing in the
browser reads a platform health report.

Two transports read the same probes:

- `/api/health/*`, the project-keyed family it has always been, with the same
  headers, statuses and bodies, now declared `handlerManagedAuth` so the route
  registry reports the credential it actually takes.
- `/api/v1/platform-health[/:check]`, the monitoring door. It is gated by a
  deployment-wide static key compared in constant time, and answers one report
  shape: an overall status, when it was checked, and one entry per subsystem.

## Dependencies

The feature depends on nothing but this deployment's own public boundary and
two lookups it is handed as technical infrastructure: whether a project holds
the workflow a probe names, and when a trigger last fired. It resolves the
probe credential to a project through the same lookup the project-keyed door
already uses.

## Persistence

None. A health report is computed per request and never stored; a monitor's
own history is the record.

## Runtime and registration

`PlatformHealthApp` is built once per process from the same collaborators the
`/api/health/*` family runs on, so the two doors cannot disagree about what a
subsystem's health is. The composition root mounts the REST family only where
both keys are configured.

## Environment and configuration

`PLATFORM_HEALTH_API_KEY` is what a monitor presents.
`PLATFORM_HEALTH_PROBE_API_KEY` is the project credential a canary is authored
with: authenticating the monitor proves who is asking and cannot also write a
trace. Both are classified secrets and both are refused blank. With either
absent the family is not mounted, so no caller reaches a platform-wide probe by
presenting nothing.

## Errors

A missing or wrong key raises `PlatformHealthUnauthorizedError`
(`platform_health_unauthorized`, 401) before any probe runs, and says nothing
about which half of the check failed. Everything else is reported rather than
thrown: a probe that fails is a `unhealthy` entry in the report, and a probe
that throws is caught and reported the same way, because a monitor that loses
the whole answer to one broken subsystem cannot tell a broken platform from a
broken health check.

## Contracts and validation

The report is a Zod 4 schema in the contract: an overall `healthy`, `degraded`
or `unhealthy`, served 200 unless it is unhealthy, which is 503. `degraded` is
the answer for a probe this deployment pointed nowhere — paging on it would
page on our own configuration, and hiding it would let a probe quietly stop
covering anything.

Each entry carries our own words for what broke, never the upstream's. The body
goes to whoever holds the monitoring key, and a health answer is not a log line.

## Consequences

The route registry now reports the credential each probe family takes, which is
what issue #7942 asked for. An external monitor stops needing a tenant's API
key to ask a platform question. The cost is a second configured credential: the
canary still has to be authored as some project, and that project is now named
by the deployment rather than by whoever polls it.
