# ADR-200: LangWatchQL answers only where the data and the isolation are

**Status:** Accepted (2026-11-10)
**Spec:** `specs/lwql/isolation.feature`
**Builds on:** ADR-084 (tenant isolation lives in ClickHouse), ADR-159 (the app owns the access model), ADR-198 (access tiers and token logins)

## Context

LangWatchQL isolates tenants inside ClickHouse: one restricted user (`langwatch_lwql`), row policies that compare `TenantId` with a per-query capability (`sha256(Project.lwqlKey)`) looked up in `lwql_api_key_tenant_map`, and PostgreSQL views read through the `lwql_postgres` named collection, whose PostgreSQL role reads every tenant's approved rows. That model is proven against the shared server (`tenant-isolation.integration.test.ts`, `postgres-engine-isolation.integration.test.ts`).

An inventory of every path by which data or a credential could cross a tenant or an instance (2026-11-10) found no cross-tenant read through the API today, and these gaps:

1. **Placement.** An organisation whose data lives on its own ClickHouse (a private instance or a customer's server) is queried on the shared server. Nothing refuses it, so it gets empty or stale answers.
2. **Key map placement.** A new project's key-map row, which carries its capability, is written through the tenant's routed client, which can be a server the customer controls.
3. **Capability in the URL.** The executor sends the capability as an HTTP query parameter, so a proxy log or a trace-level server log holds it.
4. **Users without a row policy read every tenant.** ClickHouse lets a user with no policy on a table read all of it (confirmed on 26.8). Any access-file tier or operator user granted the source or LangWatchQL database therefore reads every tenant, PostgreSQL engine tables included; a write tier can also insert a key-map row binding a new hash to another tenant.
5. **Reserved identity.** An access file may define a user named `langwatch_lwql`, adding a login and a tier to the restricted identity.

Where the capability travels was probed on 25.10 and 26.8 (2026-11-10):

- **URL setting (before this ADR):** in the server log file (the trace `Request URI` line), `system.text_log` and `system.query_log.Settings`, and in any proxy log.
- **Literal `SETTINGS` clause in the body:** in the server log file and `system.text_log` (the debug `executeQuery` line), `system.query_log.query` and `system.query_log.Settings`.
- **`{param}` in the clause:** a syntax error on 25.10; on 26.8 the value is substituted before logging. A setting sent as a multipart form field is ignored.
- **Server `query_masking_rules`:** remove a matching value from the log file, `text_log` and `query_log.query`, never from `query_log.Settings`.
- **`log_query_settings = 0` on the user's profile:** keeps `query_log.Settings` empty for that user. A trailing clause also reaches every branch of a `UNION ALL`, CTEs and joins.

Confirmed safe on 26.8: a named collection's keys cannot be overridden without `SHOW NAMED COLLECTIONS SECRETS`, which no LangWatchQL-facing user holds; the query condition cache does not carry one tenant's filter result into another's query.

Re-run on 26.8.34.13, the version the LangWatchQL server image builds on (2026-11-10):

- **The query condition cache** keeps tenants apart (tenant B reads 2, tenant A reads 0, tenant B again 2). Its `Debug` line from the key-map table's `SelectExecutor` logger still holds the capability: `Query condition cache has dropped 0/2 granules for PREWHERE condition has(_CAST(['<capability>']...), __table1.KeyHash)`. That is the only log line a `name = '...'` rule misses; the image's sha256 hex rule (#9458) hides it, and the integration test runs with the image's rules.
- **A named collection's keys** cannot be redirected by a user granted only `NAMED COLLECTION`.

25.10 differed on both (the cache crossed tenants, the override was allowed); LangWatchQL targets 26.8 only, so the isolation suites pin it.

## Decision

**One gate, fail closed.** Every LangWatchQL request, on every distribution, passes one placement gate before any SQL runs. It answers only when the organisation's data and the provisioned access model are on the same server. Otherwise it refuses by name:

- `lwql_not_enabled`: LangWatchQL is off for this deployment or organisation (existing code).
- `lwql_not_provisioned`: the organisation's data is on a server LangWatchQL is not provisioned on (a routed organisation, or a self-hosted install whose ClickHouse has no access model yet).
- `lwql_unavailable`: the gate cannot decide (route lookup fails, provisioning state unknown). Never a fallback to the shared server.

The gate reads three things:

- **Placement.** The stores' router gives its whole decision: whether the organisation is recorded as private, and the server it resolves to. An organisation recorded private whose route is missing is refused `lwql_unavailable`, never sent to the shared server. Otherwise the gate compares the resolved server's origin with the LangWatchQL target's own, not with "shared", so an `LWQL_CLICKHOUSE_URL` override is judged by where it points. An organisation the router sends to a private route is refused even when that route shares the target's origin, until the opt-in below exists.
- **Provisioning.** Config decides where it can: with no LangWatchQL server configured, the answer is `lwql_not_provisioned` without I/O. Otherwise the gate probes the server and keeps the answer, yes or no, in the module's Redis for 5 minutes, keyed by the target's origin so a changed target is probed afresh. A Redis failure refuses `lwql_unavailable`.
- **Refusal codes.** `lwql_not_provisioned` is a 403; `lwql_unavailable` is a 503.

A self-hosted install queries its own ClickHouse only once LangWatchQL is enabled and provisioned there. A routed organisation stays refused `lwql_not_provisioned`. Running LangWatchQL on an organisation's own ClickHouse will be opt-in, per organisation, set from the admin (Ops) side. That opt-in arrives through this gate, which then compares against that organisation's provisioned server. The catalogue, identity and token logins it needs are a later decision.

**The capability never leaves the LangWatchQL server.** Key-map rows are written only through the LangWatchQL admin target, never a tenant's routed client. The executor carries the capability in the request body, never in the URL, as three parts that only together keep it out of every log:

- The executor appends the statement's only `SETTINGS` clause, after checking the value is lowercase hex. The validator still refuses a caller's `SETTINGS`.
- The server masks that setting's value. The image renders three `query_masking_rules` rules per name in `CLICKHOUSE_MASKED_SETTINGS` (default `custom_api_key_hash`): the statement, URL and encoded-URL forms. It adds one rule hiding every 64-character sha256 hex value, which covers the capability wherever ClickHouse logs it folded, such as the query condition cache's debug line. The self-hosting docs give operators of an external ClickHouse the same rules.
- The restricted profile pins `log_query_settings = 0 CONST`, so `system.query_log.Settings`, which masking does not reach, never holds it.
- The audit trail names the project, not the hash. The same clause sets `log_comment = 'lwql:project=<id>[,<id>]'` from validated project ids, and the profile lets the restricted user change only that and the capability. `query_log.log_comment` therefore names each run's projects while no column holds the hash or the key. The validator refuses a caller's own `SETTINGS`, and on 26.8 a subquery's `log_comment` does not replace the executor's.

**The restricted identity opts in to what it uses.** Its profile pins `use_query_cache = 0`, `use_query_condition_cache = 0` and `allow_introspection_functions = 0` CONST beside its limits, so no server default turns a cache or introspection on for it. Its grants are exactly the LangWatchQL tables; a test fails on any grant added, and on dictGet, remote(), url(), file() or s3() answering. Deleting a key-map row stops its key on the next query, since no cache holds the old answer.

**Only the restricted identity is granted LangWatchQL data.** The image refuses an access file that names `langwatch_lwql`, or that lists the LangWatchQL database or the source database's key map for a tier. Operators who grant those through their own users.d are outside this guarantee, and the docs say so.

**Every guarantee has a test that fails if it breaks**, at the lowest level that can prove it: unit for decisions, integration against a real ClickHouse 26.8 for policies and grants, image e2e for what the image renders.

## Consequences

- A routed organisation loses LangWatchQL until it is opted in; today it gets wrong answers, so this trades silent error for a named refusal.
- The executor builds `SETTINGS` into the statement; the validator already forbids user-written `SETTINGS`, so the clause is the app's alone.
- An external ClickHouse without the masking rule keeps the capability in its logs. Adding it is the operator's job, and the docs say so; the app cannot check a server's masking rules.
- **Merge order: #9458 lands first.** It brings the 26.8 image and the masking rules this decision relies on; merged alone, this change would run on a server that neither is 26.8 nor masks the capability. The LangWatchQL integration suites pin `clickhouse/clickhouse-server:26.8.34.13` and render #9458's rules.
- Revoking a capability (rotating `lwqlKey`, deleting key-map rows) and restored backups re-adding old rows are not covered here; they need their own decision.
