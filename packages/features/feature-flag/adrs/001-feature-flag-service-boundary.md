# ADR-001: Feature flags have one service boundary

**Status:** Accepted

**Behavioural contract:** [Feature flag resolution](../specs/feature-flag.feature)

**Related:** [ADR-092](../../../../dev/docs/adr/092-authz-engine.md),
[ADR-101](../../../../dev/docs/adr/101-feature-package-surfaces.md),
[ADR-112](../../../../dev/docs/adr/112-singular-feature-ownership.md).

## Context

Feature flags were split between a global app store, per-call environment
reads and browser-local overrides. The same key could therefore resolve
differently at the server and browser, and callers could bypass composition.

Flags also need two controlled product surfaces: anonymous rollout before
sign-in, and optional experiments that people or tenant owners may enable.

## Decision

The singular `feature-flag` feature owns:

- the registry, defaults, scope and targeting rules;
- operator-row evaluation, writes and cache invalidation;
- deterministic percentage bucketing;
- experiment catalogue, enrolment and tenant policy;
- the browser-safe anonymous identifier and experiment UI.

Its contract exposes portable schemas, values, errors and one abstract
`FeatureFlagService`. Processes construct one concrete service and inject it
through the application graph. Callers do not import a store or construct a
service per request.

Resolution order is fixed: validated boot override, force-enable list,
matching operator rule, operator row, then registry default. An unknown key
throws `UnknownFeatureFlagError`; callers cannot supply a fallback default.

## Contracts and validation

Zod 4 schemas own configuration, registry metadata, rules, targets, experiment
settings and cached rows. `FeatureFlagKey` and the browser/public allowlists
bound what callers can resolve; generated Prisma types never leave the server
repositories.

## Dependencies

The concrete service receives only its own row cache and repositories plus
typed `FeatureFlagConfig` and the registry. It does not import another feature,
the process environment, PostHog, a database client or a service locator.

## Environment and configuration

Boot parses environment once into `FeatureFlagConfig`. The package never reads
`process.env`, and changing environment after boot does not mutate a running
service.

Operator rows are cached, not resolved booleans, so one entry serves every
tenant. A five-second local tier fronts the composition-owned shared cache.
Writes invalidate both. Experiment settings are read separately because they
vary by subject.

A repository read failure is logged and treated as no operator row, allowing
the registry default to decide. Malformed stored rules parse as empty and
unknown rule conditions fail closed.

## Public surfaces and transports

Authenticated target input never contains `userId`; transport derives it from
the session. Project and organisation targets are authorised against the exact
requested scope, and a project is checked against its owning organisation.
Legacy per-organisation procedures silently omit non-members to avoid becoming
a membership oracle.

The service accepts that canonical target directly. It derives tenant rule
context and percentage bucketing centrally; callers do not pass separate
identity, bucketing, project and organisation argument bags.

The authenticated map contains only registered browser flags. The anonymous
map has a separate, smaller allowlist. Its random v4 browser identifier is
stored alone; it is not a device fingerprint and rotates when site data is
cleared.

Existing tRPC names and response shapes remain compatibility contracts. New
map and experiment procedures are additive. Ops administration uses the same
service as runtime evaluation.

## Experiments

Only a browser-visible product flag may declare experiment metadata.
Catalogue versions increase monotonically so the browser can show a local
discovery marker without changing evaluation.

An experiment first has to be available through normal flag resolution. A
project policy then overrides its organisation policy; an explicit tenant
policy overrides personal enrolment. Unavailable experiments are absent from
the catalogue. A tenant-disabled experiment remains visible so an owner can
reverse the decision.

Personal enrolment is stored only for authenticated users. Leaving deletes the
row. Anonymous experiments must opt into the public allowlist and have no
personal or tenant preference.

Tenant policies are manager data. The authenticated catalogue transport strips
project and organisation policies unless the viewer holds
`featureFlags:manageExperiments` on that exact scope.

## Persistence

`FeatureFlag` stores the cluster-wide operator row and rules.
`FeatureFlagExperimentSetting` stores one value per flag and subject. Neither
table is project data, so every target is authorised before access. Generated
Prisma types stay inside the server repositories.

The old app store, service locator and local override drawer are displaced and
must be deleted. App code may retain only transport and process-composition
adapters; it contains no feature-flag business logic.

## Runtime and registration

Boot composes one service instance over Postgres and the process-owned cache,
then exposes it through `app.featureFlags`. Hono, tRPC, workers and other
features receive that instance; none register or construct it on demand.

## Errors

Unknown flags and invalid experiment operations throw concrete contract
errors. Transport maps authorisation failures separately. Store read failures
degrade to the registry default, while writes and invalid input fail normally.

## Consequences

One decision path now serves operator, backend and browser callers, and a flag
cannot silently invent a caller-specific default. A new flag requires a code
change; anonymous exposure requires an explicit public allowlist entry. Flag
changes may take up to the bounded cache window to reach every process.
