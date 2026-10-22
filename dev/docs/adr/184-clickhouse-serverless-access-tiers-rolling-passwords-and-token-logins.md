# ADR-184: clickhouse-serverless access - tiers, rolling passwords and OIDC token logins, rendered as files

**Date:** 2026-10-23

**Status:** Accepted

## Context

`langwatch/clickhouse-serverless` is a public image. Self-hosters, bring-your-own-cloud installs and LangWatch's own deployments all run it. Until now it rendered one identity, the `default` admin user, from `CLICKHOUSE_PASSWORD`. Every other login (a Grafana data source, a BI tool, a person debugging a query) was a file the operator wrote by hand, with a password that could only change by restarting the server and breaking every client at once. People shared the admin password because nothing else was easy.

The infra compose file shipped a fixed `langwatch` password with port 8123 published on every interface, so a quick start was a reachable admin login with a known password.

What operators asked for: no default passwords anywhere; a small set of named privilege levels; passwords that rotate with two valid at once; short-lived logins for people and machines from the identity provider they already run; and all of it off by default, generic, with no cloud-specific code.

## Decision

### 1. No default passwords, without breaking existing installs

The image refuses to start without a password for the `default` user, as it already did (an empty `CLICKHOUSE_PASSWORD` and no `CLICKHOUSE_PASSWORD_FILE`). Nothing that started before is refused now: a published default (`langwatch`, `clickhouse`, `password`, `default`, case-insensitive) or a whitespace-only password still starts, and `ch-config` logs a warning at every boot saying how to set one. `infra/compose.yml` takes `CLICKHOUSE_PASSWORD` from `.env` and falls back to the published `langwatch`, so an existing `docker compose up` keeps working with its data and its app URLs; `.env.example` and the docs tell new installs to generate one (`openssl rand -hex 24`). The fallback is deprecated, warned about at every boot, and removed in the next major release, when an unset password stops compose. The CI start script no longer falls back to a built-in value. The chart is unchanged: `autogen.enabled` still generates a random password and `auth.existingSecret` still reads the operator's. Local development stacks (`dev/compose.dev.yml`, haven, the upgrade harnesses) keep their explicit local-only credentials: they are set, not defaulted, and none is published beyond the developer's machine.

### 2. Four tiers, rendered with access

With an access file (`CLICKHOUSE_ACCESS_FILE`, or the chart's `access.enabled`), or with `CLICKHOUSE_ACCESS_TIERS=true` for operator-written users, `ch-config` writes `users.d/access-tiers.yaml` at every start: one role and one settings profile per tier. Without either, no `tier_*` role or profile exists, so an existing install sees no new entities and no reserved names; turning access off again removes the file.

| Tier | Role grants | Per-user grants on each listed database | Profile |
|---|---|---|---|
| `tier_inspect` | `SHOW ON *.*`, `SELECT ON information_schema.*` | none (no database list) | `readonly=2`, capped execution time and memory |
| `tier_read` | as inspect | `SELECT` | as inspect |
| `tier_write` | as inspect | `SELECT, INSERT, ALTER UPDATE, ALTER DELETE` (lightweight `DELETE` checks `ALTER DELETE`) | capped memory, writable |
| `tier_admin` | `ALL ON *.* WITH GRANT OPTION` | none | inherits `default` |

Tier = what, databases = where. A tier role carries only database-independent grants; the database list becomes direct grants on the user. Read profiles use `readonly=2`, not `1`, because tools such as Grafana set `max_execution_time` per query and `readonly=1` rejects that; constraints cap `max_execution_time` (`READ_TIER_MAX_EXECUTION_TIME`, default 300 s) and `max_memory_usage` (the computed per-query budget) so a read user cannot raise them. The `tier_` prefix keeps the names clear of roles an operator already created.

`access_control_improvements.select_from_system_db_requires_grant` is already `true` in 26.8 (`src/Access/AccessControl.cpp:300` defaults it to true and `programs/server/config.xml:887` sets it), so `system.query_log` and its peers, which hold query text, are closed to every non-admin user today. Only `system.databases`, `tables`, `columns`, a few constant tables and the caller's own `user_query_log` stay readable, filtered by SHOW privileges (`src/Access/ContextAccess.cpp:197-260`). The image therefore changes nothing about that setting and no existing user (`default`, operator-written users) loses access.

Existing users keep today's grants. An operator maps one of their own `users.d` users to a tier, with the tiers rendered, by giving it `profile: tier_read` and `grants: [GRANT tier_read, GRANT SELECT ON db.*]`; the image does not rewrite operator files.

### 3. One optional file, `access.yaml`

`CLICKHOUSE_ACCESS_FILE` names it. Absent, the image behaves as before. Present, it is decoded strictly (unknown keys, unknown tiers or issuers, duplicate names, bad networks, a database list on a tier that takes none, an admin token user whose issuer does not set `allow_admin`) and any error stops the server from starting. It declares issuers and users; each user has exactly one tier, a database list where the tier needs one, optional networks, and exactly one login:

- `rolling: { dir: <path> }` - every regular, non-hidden file in the directory is a valid password (at least 16 characters, at most 8 files). A sibling `<name>.valid_until` holding an RFC 3339 instant ends that password at that instant.
- `token: { issuer: <name>, subject: <claim value> }` - an OIDC JWT from that issuer whose `username_claim` equals `subject` (default: the user's name).

Operator-written `users.d` files (static users) are not part of `access.yaml` and stay untouched.

### 4. Delivered as a rendered `users.d` file, kept current by a sidecar

The approved design proposed SQL users in `<replicated>` access storage, reconciled with `ALTER USER ... ADD IDENTIFIED ... VALID UNTIL` by a dedicated admin identity. We render file-defined users instead: `users.d/access-users.yaml`, one `auth_methods` entry per valid password (`password_sha256_hex`) or one `http_authentication` method per token user, plus the user's networks, profile and grants. ClickHouse reloads `users.d` without a restart (`src/Common/Config/ConfigReloader.cpp`, default every 2 s, change detected by file modification time).

`ch-config sidecar` keeps that file current. Every 10 seconds, and at the next `valid_until`, it re-reads `access.yaml` and the password directories, computes the document with a pure function (`access.Plan(file, passwords, now)`), and replaces the file atomically only when the bytes differ. When an input cannot be read it logs the error and keeps the last good file, so a transient mount problem never locks anyone out. `ch-config generate` runs the same plan at startup.

Why not the SQL design:

- `<replicated>` access storage was rejected for this deployment shape in #7331 and again in ADR-159; this repository chose rendered files for the LangWatchQL access model for the same reasons. Files keep every pod self-consistent with its own mounts and need no Keeper path, no access-storage migration and no ordering between storages.
- No reconciler identity exists, so there is no extra admin credential with `access_management` to provision, rotate or leak.
- During a rotation Kubernetes updates Secret volumes on each pod at a different moment. With shared SQL storage, a pod that still sees the old files would overwrite what a newer pod applied, every sync, until both converge. With files each pod applies only what it sees.
- No password hash travels over SQL or lands in query logs.

The cost: ClickHouse's config grammar has no per-method `VALID UNTIL` (`src/Access/UsersConfigParser.cpp` parses none), so expiry is enforced by the sidecar removing the method within 10 seconds, and by `generate` at every start. While the sidecar is down an expired password stays valid; the chart runs it as its own container so Kubernetes restarts it. Revocation by deleting the file is the primary path; `valid_until` is a convenience.

### 5. Token logins verified by the sidecar over loopback

When `access.yaml` is set, `ch-config` renders `http_authentication_servers.access` pointing at `http://127.0.0.1:8124/verify` (`CLICKHOUSE_ACCESS_LISTEN`, which must be a loopback address). ClickHouse sends the login name and the password (the JWT) as HTTP Basic credentials in a `GET`, and treats `200` as success and anything else as failure (`src/Access/HTTPAuthClient.h`, `src/Access/SettingsAuthResponseParser.cpp`). The same path serves HTTP and native-protocol logins, because both arrive as `BasicCredentials` (`src/Access/Authentication.cpp:234`). Native JWT authentication exists only in ClickHouse Cloud (`src/Access/AuthenticationData.cpp:418`), hence the sidecar.

The sidecar accepts a token only when all hold:

1. The login name is a token user in `access.yaml`; the issuer is the one that user names, never the token's own `iss` choice.
2. The signature verifies against that issuer's JWKS, found by OIDC discovery (`<url>/.well-known/openid-configuration`, whose `issuer` must equal the configured URL) or a configured `jwks_url`. Allowed algorithms are RS/PS/ES 256-512 and EdDSA; `none` and HMAC are refused.
3. `iss` equals the issuer URL, `aud` contains its `audience` (default `clickhouse`), `exp` is present and in the future and `nbf` has passed, with 30 seconds of leeway.
4. The issuer's `username_claim` (default `sub`) equals the user's `subject`, and every `required_claims` entry (for example `email_verified: true`) matches exactly.

An explicit `subject` per user replaces the design's username template. Mapping the local part of an email (`alice@...` to `alice`) would let any account at any domain the issuer serves claim `alice`, so the binding is a full claim value or nothing.

ClickHouse re-authenticates every HTTP request and caches only LDAP results (`src/Access/ExternalAuthenticators.cpp`), so the sidecar caches each verified (user, token) pair until the token's `exp`, keyed by a SHA-256 of both, at most 10 000 entries, cleared whenever `access.yaml` changes. Keys are fetched at start and refreshed every 15 minutes; a token signed by an unknown `kid` triggers at most one refetch per issuer every 30 seconds, so a rotated key works within seconds and a flood of forged `kid`s cannot hammer the issuer. Issuer URLs must be `https`, except loopback (tests). A per-issuer `ca_file` trusts a private CA, for in-cluster Kubernetes issuers. ClickHouse waits up to 5 seconds for the sidecar (`receive_timeout_ms`), enough for a cold JWKS fetch.

JWT size: the native protocol accepts a password of up to 64 KiB (`MAX_HELLO_STRING_SIZE`, `src/Server/TCPHandler.cpp:2093`) and HTTP a header value of up to 128 KiB (`http_max_field_value_size`). The sidecar refuses tokens over 16 KiB. Typical OIDC tokens are 1 to 2 KiB.

Token verification uses `github.com/go-jose/go-jose/v4`, already in this workspace's module graph. It parses JWKS (RSA, EC and OKP keys) and verifies compact JWS against an explicit algorithm allowlist; `golang-jwt/jwt/v5`, also in the workspace, has no JWKS support, and hand-parsing key material is where verification bugs live.

### 6. Where it runs

The chart (`access.enabled`, off by default) runs the sidecar as a second container of the ClickHouse pod, sharing `users.d`, the `access.yaml` ConfigMap and the listed password Secrets. A plain `docker run` with `CLICKHOUSE_ACCESS_FILE` set runs it inside the same container (`CLICKHOUSE_ACCESS_SIDECAR=embedded`, the default), supervised by the entrypoint.

## Rationale / Trade-offs

Rendering files keeps the whole feature inside what the image already does (render config, let ClickHouse reload it) and adds one long-running process with two jobs: re-render, and answer token checks. The SQL design would have matched ClickHouse's own expiry semantics, which is its real advantage; we accepted a sidecar-enforced expiry with a bounded window over a second admin identity, Keeper-backed access storage the repository has rejected twice, and cross-replica write-backs during rotation.

A directory of password files beat `current` plus `previous {file, valid_until}`. The two-key shape needs the Secret (new password) and the `access.yaml` ConfigMap (expiry) to change together, and Kubernetes updates them independently. With a directory the operator only adds and removes Secret keys, which Helm, External Secrets and Terraform all express as a map.

## Consequences

- Nothing changes by default for an existing install (Docker Compose, Helm, bring-your-own-cloud): no new roles, profiles, containers, ports or mounts, and the same password rules. Every new behaviour is opt-in: `CLICKHOUSE_ACCESS_FILE` (chart `access.enabled`), `CLICKHOUSE_ACCESS_TIERS`.
- A Docker Compose install still on the published `langwatch` password logs a warning at every boot until `.env` sets `CLICKHOUSE_PASSWORD`. Existing data is kept; the password is applied at each start, and the app's `CLICKHOUSE_URL` follows the same variable. The next major release removes the fallback.
- With the tiers rendered, `tier_inspect`, `tier_read`, `tier_write`, `tier_admin` are reserved role and profile names.
- The chart's `users` value, documented earlier but never rendered, stays accepted as a deprecated no-op with a NOTES warning, and goes in the next major release.
- An `access.yaml` user must not also be defined as a SQL user or in an operator's own `users.d` file. `ch-config` cannot see either: a second `users.d` definition merges into the rendered one and a SQL user of the same name is shadowed by it. Migrating a user means dropping the old definition once its consumers moved.
- Changes to `access.yaml` and to password directories apply live within about 10 seconds; changing the sidecar's listen address or adding the first `access.yaml` needs a restart, because the auth server is part of the server config.
- Rolling user names are restricted to `[A-Za-z_][A-Za-z0-9_-]*` (a dot breaks ClickHouse's config paths).

## References

- Spec: [`specs/clickhouse/serverless-access.feature`](../../../specs/clickhouse/serverless-access.feature)
- Related ADRs: [ADR-159](./159-the-app-owns-the-lwql-access-model.md) (rendered access delivery, `<replicated>` storage rejected)
- ClickHouse source at tag `v26.8.34.13-lts`: `src/Access/UsersConfigParser.cpp` (`auth_methods`, `http_authentication`, config roles and grants), `src/Access/ExternalAuthenticators.cpp` (`http_authentication_servers` keys: `uri`, `connection_timeout_ms`, `receive_timeout_ms`, `send_timeout_ms`, `max_tries`, `retry_initial_backoff_ms`, `retry_max_backoff_ms`, `forward_headers`), `src/Access/IAccessStorage.cpp` (per-method `VALID UNTIL` checked at login, SQL storage only), `src/Parsers/Access/ParserCreateUserQuery.cpp` (`ADD IDENTIFIED`, per-method `VALID UNTIL`, `http SERVER ... SCHEME`), `src/Storages/System/StorageSystemUsers.cpp` (`system.users` exposes types and `valid_until`, never hashes), `tests/integration/test_external_http_authenticator`
- Image docs: `infra/clickhouse-serverless/README.md`; chart: `charts/clickhouse-serverless/README.md`; operator guide: `docs/self-hosting/configuration/clickhouse-access.mdx`
