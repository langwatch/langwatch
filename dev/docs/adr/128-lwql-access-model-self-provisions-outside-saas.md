# ADR-128: The LangWatchQL ClickHouse access model self-provisions outside SaaS

**Date:** 2026-09-02

**Status:** Proposed

**Related:** [ADR-081](./081-lwql-table-function-and-ssrf-policy.md),
[ADR-082](./082-lwql-analytics-views-invoker-column-grants-final-dedup.md),
[ADR-084](./084-lwql-postgres-mapping-tenant-predicate.md) — the LangWatchQL
access model this decision changes the *ownership* of, not the *shape* of.

## Context

LangWatchQL runs customer-written ClickHouse SQL as a single restricted
identity, bounded by a settings profile, per-object row policies, and a key-map
table. The SQL that provisions that access model has always lived in the repo
(`server/analytics/lwql/provisioning.ts`), but no in-repo path applied it: the
access model was Terraform-owned, provisioned out of band against a
server-managed identity (langwatch-saas#1126).

That was fine for SaaS and inert everywhere else. Every in-repo surface — the
compose quickstart, haven, and the Helm chart — sets none of the five `LWQL_*`
environment variables, so `lwqlConnectionFromEnv()` returned `null` and the
whole feature was off outside SaaS. The one path that could turn it on,
`LWQL_SELF_PROVISION_ACCESS_MODEL=true`, was opt-in and off by default, so it
was never exercised by a default deploy.

The failure this surfaced: a hand-provisioned dev box had its access model set
up once, by hand, then drifted as the view catalog grew. A view added to the
catalog later was created by the deploy task but never granted to the restricted
identity, so every query touching it failed `ACCESS_DENIED` — the exact
grant-drift gap the on-boot reconcile exists to close, left open because the
reconcile was opt-in.

## Decision

We will self-provision the ClickHouse access model by default, keyed off
`!IS_SAAS`. The deploy task (`tasks/provisionLwql.ts`) reconciles the restricted
user, settings profile, grants, and row policies on every boot outside SaaS,
using the same `lwqlClickHouseSetupStatements` SQL the isolation-proof suite
already exercises. A new pure predicate,
`shouldSelfProvisionLwqlAccessModel({ override, isSaas })`, decides this and
nothing else, so the gate is unit-testable without an environment.

`LWQL_SELF_PROVISION_ACCESS_MODEL` remains an explicit override in both
directions: `"true"` forces self-provisioning on even in SaaS, `"false"` forces
it off (a self-hoster whose grants are managed externally), and unset resolves
to `!IS_SAAS`. This preserves today's SaaS behavior exactly — SaaS with no
override self-provisions nothing.

The five `LWQL_*` connection variables (`LWQL_CLICKHOUSE_URL`,
`LWQL_CLICKHOUSE_USER`, `LWQL_CLICKHOUSE_PASSWORD`, `LWQL_DATABASE`,
`LWQL_TENANT_SETTING`) stay explicitly required. When they are unset the task
still exits early via `lwqlConnectionFromEnv()` returning `null`, unchanged, and
the self-provisioning block requiring `LWQL_CLICKHOUSE_PASSWORD` is unchanged.
This change moves the *default* of an existing opt-in switch and corrects the
comments that framed the access model as unconditionally infra-owned; it does
not add connection derivation.

SaaS keeps Terraform as the single writer to the ClickHouse access model,
deliberately:

- **(a) Single writer to the security boundary.** During an incident the access
  model is a boundary that must have exactly one owner; two writers racing to
  reconcile grants is a worse failure than a stale grant.
- **(b) The Cloud runtime identity is unprivileged anyway.** The app runtime in
  SaaS holds no DDL privileges by design — the same framing
  `withAdminClickHouseClient`'s own doc comment states — so it *cannot* issue
  `CREATE USER`/`GRANT` against the server-managed identity even if asked to.
- **(c) No grant-rewriting capability in multi-tenant prod.** A multi-tenant
  production app runtime should not carry the ability to rewrite the access
  model that isolates its tenants.

## Rationale / Trade-offs

The alternative — leaving self-provisioning opt-in — keeps the app runtime
free of any access-model responsibility everywhere, but it is what left the
feature inert and drift-prone outside SaaS. Flipping the default trades a
narrowly-scoped, log-and-continue reconcile on non-SaaS boot (queries already
fail closed when the model is absent, so a reconcile hiccup costs nothing extra
in availability terms) for LangWatchQL that actually works out of the box on
local and self-hosted deploys. The SaaS carve-out keeps the strongest property —
a single, unprivileged-runtime, Terraform-owned boundary — exactly where it
matters most.

## Consequences

- LangWatchQL now converges its own ClickHouse access model on every non-SaaS
  boot, so a view added to the catalog is granted to the restricted identity in
  the same deploy that creates it — the grant-drift `ACCESS_DENIED` gap is
  closed for local and self-hosted deploys.
- SaaS behavior is byte-for-byte unchanged: no override, `IS_SAAS` truthy, the
  self-provisioning block does not run.

Known open gaps, filed as follow-ups and deliberately **not** addressed here:

- **Chart ClickHouse config lacks the custom-settings prefix.** The access
  model's settings profile declares a `custom_` setting, which requires the
  server-level `<custom_settings_prefixes>custom_</custom_settings_prefixes>`
  block that `provisioning.ts` documents as
  `CLICKHOUSE_CUSTOM_SETTINGS_PREFIX_CONFIG_XML`, installed at
  `CLICKHOUSE_CUSTOM_SETTINGS_PREFIX_CONFIG_PATH`. That XML block appears in no
  chart in this repo (only in `provisioning.ts` and the test harness), so a
  chart-managed ClickHouse will still fail self-provisioning with
  `UNKNOWN_SETTING` (error code 115) until the chart is updated. Follow-up:
  ship that config block in `charts/clickhouse-serverless`. Not fixed here.
- **Zero-config connection derivation — rejected for now as YAGNI.** A future
  change could drop the five required `LWQL_*` variables entirely and derive the
  connection (host/port/scheme from `CLICKHOUSE_URL`, a deterministic password
  from a stable app secret such as `NEXTAUTH_SECRET`, canonical defaults for the
  user/database/tenant-setting), so LangWatchQL runs truly zero-config. It is
  intentionally out of scope: this change makes the access model self-provision,
  which is the drift fix; derivation is a separate ergonomics step with its own
  secret-derivation and topology-consistency questions, and is not a consequence
  of this decision.
- **SaaS catalog ↔ Terraform drift needs CI coupling.** The reference SQL in
  `provisioning.ts` and the Terraform that must match it in SaaS can still
  diverge silently. Follow-up against langwatch-saas#1126.

## References

- `platform/app/src/tasks/provisionLwql.ts` — the deploy task and the gate wiring
- `platform/app/src/server/analytics/lwql/productionProvisioning.ts` —
  `shouldSelfProvisionLwqlAccessModel`, the pure gate predicate
- `platform/app/src/server/analytics/lwql/provisioning.ts` —
  `lwqlClickHouseSetupStatements` (the access-model SQL) and the
  `CLICKHOUSE_CUSTOM_SETTINGS_PREFIX_CONFIG_XML` / `_PATH` prerequisite
- Related ADRs: [081](./081-lwql-table-function-and-ssrf-policy.md),
  [082](./082-lwql-analytics-views-invoker-column-grants-final-dedup.md),
  [084](./084-lwql-postgres-mapping-tenant-predicate.md)
- langwatch-saas#1126 — the Terraform-owned SaaS access model
