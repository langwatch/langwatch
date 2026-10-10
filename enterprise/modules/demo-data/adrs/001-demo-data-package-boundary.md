# ADR-001: Demo Data package boundary

**Status:** proposed

**Behavioural contract:** [Demo organization seeding](../specs/demo-data.feature)

## Context

Main seeded the demo organization from an HTTP cron route. The seeding now
lives in one enterprise module so its schedule, its scope checks and its
report have one owner.

## Decision

`demo-data` owns seeding the demo organization. It exposes `DemoDataApi`
(`runSeedDemo`) and returns a `SeedRunReport`. The contract holds the Api
token, the run input, the report shape and the module config.

## Public surfaces and transports

No REST or tRPC transport. A run starts from the daily scheduled process or
from the one-shot `DemoDataTask`.

## Dependencies

`OrganizationApi`, to read the demo organization's name and slug, which the
first action verifies. The logger is the only member read.

## Persistence

None of its own. The `seed_demo` pipeline is a global aggregate with no
events; its process-manager state is the only state it keeps.

## Runtime and registration

`demoDataProcessModule` registers the Api, the `seed_demo` eventing pipeline
(a scheduled process manager waking once a day) and the `DemoDataTask`.

## Environment and configuration

`demoDataConfig` enters through the module's config at composition, including
the `DEMO_ORG_IDS` allowlist; module code reads no environment.

## Errors

With no usable `DEMO_ORG_IDS` allowlist, or an organization outside it, the
scope rules refuse the run before it seeds anything. Each seed action records
`succeeded`, `skipped` or `failed` in the `SeedRunReport`.

## Contracts and validation

The run input and report are contract schemas, parsed at the Api boundary.

## Consequences

One owner for demo seeding; the cron route is gone and the schedule is
replayable eventing state.
