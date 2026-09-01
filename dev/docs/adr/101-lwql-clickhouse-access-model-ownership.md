# ADR-101: The ClickHouse server owner owns the LangWatchQL access model

**Date:** 2026-09-01

**Status:** Accepted

## Context

LangWatchQL (LWQL) needs a restricted ClickHouse identity (`langwatch_lwql`), a
settings profile (`lwql_restricted`), row policies, and a PostgreSQL bridge
named collection (`lwql_postgres`). Two different systems are able to create
these objects:

1. **Rendered config**, written to `config.d/` and `users.d/` at pod boot —
   used by the SaaS terraform provisioner
   (`infrastructure/clickhouse-serverless/scripts/render-config.sh` in
   `langwatch-saas`) and by the `charts/clickhouse-serverless` subchart
   (`infra/clickhouse-serverless/internal/render/lwql.go`).
2. **Application SQL DDL**, issued at app startup — the self-provisioning path
   in `platform/app/src/server/analytics/lwql/selfProvisioning.ts` and
   `provisioning.ts`.

ClickHouse treats a name collision between these two systems as fatal, not as
a silent override:

- A named collection defined twice (once in config, once via
  `CREATE NAMED COLLECTION`) raises `NAMED_COLLECTION_ALREADY_EXISTS` and
  **blocks server boot** — every pod that reads the config fails to start.
- Config-defined access entities (users, profiles, row policies) are
  immutable from SQL. Application DDL running against a name it does not own
  fails every repair statement, including `DROP ... IF EXISTS`, with ClickHouse
  error code 495 (`ACCESS_DENIED`) — because the entity is not in the SQL
  store the DDL is allowed to touch.

The underlying mechanic: `NamedCollectionsFactory` loads config-defined
collections at startup and a subsequent `CREATE NAMED COLLECTION` of the same
name is an `add()` of an existing key, which raises `NAMED_COLLECTION_ALREADY_EXISTS`
and aborts boot. The reverse order does not save it either — a collection first
created via SQL is written to the access store on the data PVC and survives a
restart, so once the config-defined collection also appears the two collide on
the next boot regardless of which was written first. One owner per name is the
only stable state.

## Decision

**One owner per entity name, always.** Whoever owns the ClickHouse server owns
the access model for that server:

| ClickHouse is... | Access model owner | Mechanism |
| --- | --- | --- |
| Chart-managed (`clickhouse.chartManaged: true`, the default) or SaaS-managed | The rendered config | `charts/clickhouse-serverless` (chart path) / `render-config.sh` (SaaS path) writes `langwatch_lwql`, `lwql_restricted`, the row policies, and the `lwql_postgres` named collection as XML/YAML config at pod boot. Re-read on every restart; no SQL DDL for these objects ever runs. |
| External / BYO (`clickhouse.chartManaged: false`) | The application | The app cannot render config into a server it does not run, so it self-provisions the same objects via SQL DDL on every boot, and degrades to a logged, fail-closed refusal if the server rejects a statement. |

This is enforced structurally, not just by convention: `charts/langwatch`'s
`langwatch.lwql.selfProvisionActive` helper (`templates/_helpers.tpl`) gates
app self-provisioning on `and .Values.lwql.enabled (not
.Values.clickhouse.chartManaged)` — the same switch that decides whether the
`clickhouse-serverless` subchart is even installed. The two paths are
mutually exclusive by construction, not merely default-off.

## Rationale / Trade-offs

The alternative — letting both systems define the same objects "just in
case" — was rejected because ClickHouse's failure mode for a double
definition is not graceful. A named-collection collision is a boot-blocking
error on every replica, and a shadowed access entity fails silently until
someone runs a repair statement and hits error 495. Neither failure mode is
one an operator should discover in production.

The cost of this decision is that **BYO ClickHouse must grant the app
administrative DDL rights it would not otherwise need** — `access_management`,
`named_collection_control`, and the `custom_` settings prefix (see
`charts/langwatch/README.md`, "LangWatchQL (LWQL)" section, for the exact
prerequisites). That is an unavoidable consequence of "the app is the only
thing that can create these objects when it does not own the server."

## Consequences

- Adding a new LWQL object (a view, a source table, a grant) must be added to
  **both** provisioning implementations — the config renderer and
  `provisioning.ts` — since only one runs against any given server, and they
  must stay in sync in what they create.
- Migrating a server from one ownership model to the other (e.g. SaaS
  terraform's one-shot Job → rendered XML, tracked in issue
  langwatch-saas#1168) requires dropping the SQL-owned entity on every node
  **before** any pod boots with the config-owned entity — the ordering
  constraint above, not a preference.
- The plaintext-password caveat for `lwql_postgres` (see
  `charts/langwatch/README.md` and
  `infra/clickhouse-serverless/internal/render/lwql.go:140-153`) applies only
  to the rendered-config path: ClickHouse must dial PostgreSQL with the real
  credential, so unlike every other rendered credential this one cannot be
  hashed and lands in plaintext in `config.d/`.

## References

- Issue: https://github.com/langwatch/langwatch-saas/issues/1168 (Design C)
- Related: `charts/langwatch/README.md` ("LangWatchQL (LWQL)")
- Related: `charts/clickhouse-serverless/README.md`, `infra/clickhouse-serverless/README.md`
- `platform/app/src/server/analytics/lwql/provisioning.ts`
- `infra/clickhouse-serverless/internal/render/lwql.go`
- `charts/langwatch/templates/_helpers.tpl` (`langwatch.lwql.selfProvisionActive`)
