# apidiff

`apidiff` compares the live behavior of two LangWatch API instances. It
fetches each instance's served OpenAPI document (`GET /api/openapi.json`),
reports spec-level changes (via `openapidiff`), then probes the union of
documented operations on both instances in lockstep — every probe case runs on
the candidate first and immediately after on the base, keeping both databases
in the same state — and reports behavioral differences: status codes,
response shapes, validation envelopes, and mutation outcomes. Volatile values
(ids, timestamps, secrets) are masked before comparison, so per-instance
state never produces false diffs.

```text
apidiff run   [-main-ref REF] [-branch-dir DIR] [-work-root DIR]
              [-keep] [-reuse-worktrees] [-skip-install] [-boot-timeout DUR]
              [-pg-url URL -ch-url URL -redis-url URL] [-compose-project NAME]
              [probe flags...]

apidiff probe -a URL -b URL [-project-key KEY] [-org-key KEY] [-admin-key KEY]
              [-scim-key KEY] [-project-key-b KEY] [-project-key-c KEY]
              [-concurrency N] [-timeout DUR] [-path-prefix P]
              [-method M] [-exact-status] [-exclude-prefix P]... [-max-ops N]
              [-json] [-report FILE]
```

`run` boots both instances itself — a detached git worktree for `-main-ref`
(default `main`), the current checkout for the branch — with isolated
Postgres/ClickHouse databases (run-scoped: `apidiff_<runid>_branch` /
`apidiff_<runid>_main`, where the run id derives from the work-root name) and
Redis logical DBs (14/15), migrates and seeds each, waits for health, probes,
and tears everything down. `probe` compares two already-running instances.

Exit status is `0` for no behavioral differences, `1` for differences found,
and `2` for operational or usage errors. Progress (boot phases, per-operation
probing) streams to stderr; stdout carries only the deterministic summary, or
the machine report with `-json` (optionally to `-report FILE`).

## Boot details

- Each worktree boots through a detected profile: `apps/api`
  (`@langwatch/platform-api`) is the **modular** layout (root migrate/seed
  scripts, `API_PORT` on process env — node `--env-file` never overrides it);
  `platform/app` (`@langwatch/web`) is the **monolith** layout (ClickHouse
  migration via `pnpm --filter @langwatch/web clickhouse:migrate`, start via
  `start:app:dev`, `PORT`+`LANGWATCH_API_PORT` pinned to the allocated port).
  The monolith's `env-load.ts` applies `.env` then `.env.portless` with
  `override: true`, so its per-instance env is written to
  `platform/app/.env.portless` before migrate/seed/start — that file wins over
  any `.env` a post-checkout hook copied into the worktree. Any other layout
  errors clearly.
- Infrastructure comes from `dev/compose.dev.yml` under the `apidiff` compose
  project with a generated ports/volumes override (`!override` requires
  docker compose v2.24+), so the tool's stack never collides with a running
  dev stack. ClickHouse is capped at 2g in the override (the dev stack's 4g
  does not fit a 4 GiB VM beside postgres and redis). After compose `--wait`,
  the tool polls postgres itself until `SELECT 1` succeeds AND
  `pg_is_in_recovery()` is false — a fresh-volume postgres can still be in
  crash recovery when the container healthcheck goes green, and probing a
  recovering server produces false findings. On teardown without `-keep`,
  compose `down -v` removes the managed stack; with external servers, exactly
  the run-scoped databases are dropped. `-pg-url`/`-ch-url`/`-redis-url`
  (given together) point at user-managed servers instead; external Postgres
  administration then needs `psql` on PATH.
- Credentials default to the deterministic seed identity:
  `sk-lw-local-development-key` (project key) and the fixed local-dev private
  access token (organization bearer, which also satisfies `admin_api_key`).
  In `run` mode a throwaway `LANGWATCH_INSTANCE_ADMIN_API_KEY` is injected
  into both instances and a fixed SCIM token (`ScimToken` row, plain sha256 —
  both layouts verify identically) is inserted after seeding; probing defaults
  `-admin-key`/`-scim-key` to them. In `probe` mode both stay explicit. A
  scheme without a key never skips the operation — it is probed without that
  credential, and a 401-vs-404 divergence is itself evidence.
- The branch's `/api` ↔ `/api/v1` auto-alias is collapsed: `/api/v1/<rest>`
  and `/api/<rest>` are the same operation for the spec diff, the union, and
  findings — unless `<rest>` opens with its own version segment (`/api/v1/v2`,
  and versioned families like `/api/otel/v1`, `/api/scim/v2`,
  `/api/gateway/v1` never match the rule's prefix). Each side is probed at the
  alias form its own spec documents (`/api/v1` preferred when both exist); a
  side documenting neither is probed at the canonical bare form anyway, so an
  undocumented-but-mounted route still shows up. The transcript records both
  probed paths.
- Status codes compare by CLASS (2xx/3xx/4xx/5xx): same-class differences
  (400 vs 422, 403 vs 401) are suppressed — the error envelope is
  handlederror's domain — and error bodies (both sides ≥ 400) are never
  compared. Success bodies still get full shape + value comparison.
  `-exact-status` restores exact-code and error-body comparison. The summary
  ends with a `suppressed: N same-class status differences, M error-body
  comparisons` line.
- `/api/gateway` operations are excluded by default (they egress to real LLM
  providers); repeat `-exclude-prefix` to add more.
- Idempotent probes (GET/HEAD/OPTIONS) retry up to 2 times on 5xx with
  backoff (500ms, 1s), so a momentary database restart or recovery window
  degrades into a slow probe instead of false findings. Mutations are never
  retried — replaying one could double-apply — and transport errors fail
  fast. A 5xx that persists through the retries is a real finding.

## Probing depth

- GET/HEAD: one valid request per operation.
- POST/PUT/PATCH: a validation probe (empty or type-confused body, comparing
  the full error envelope shape) plus a valid mutation synthesized from the
  request schema — spec examples win; otherwise enums take their first value,
  required fields only, `date-time` becomes the fixed `2026-01-01T00:00:00Z`.
- DELETE: only with an ID captured from an earlier response this run or from
  the seeded constants.
- Path/required-query parameters resolve from spec examples/defaults, then
  the seeded constants (`local-dev-project`, `local-dev-organization`,
  `local-dev-team`), then IDs captured from earlier responses. Unresolvable
  parameters skip the operation with a recorded reason.
- **Collection verification** (after the main pass): when a mutation created
  an entity, every matching list GET (same path, or the GET path is an
  ancestor of the POST path) is re-probed and the entity must be VISIBLE in
  each side's list — `mutation_not_visible` when exactly one side loses it.
  Visible-on-both means the non-empty list shapes get compared, which is the
  real layout check. A list GET that answered 2xx with empty lists on both
  sides and had no mutation coverage is reported as `unverified_shape`
  (coverage note, never a difference, own section in the report).
- **Permission probes** (after the main pass): every project-key read is
  repeated with the sibling-project key (B: same org, wrong project) and the
  foreign-org key (C). A 2xx answer carrying the owning project's captured
  IDs is a `permission_leak` even when both sides leak identically; a denial
  class disagreement is a `permission_diff`. Mutations are never replayed
  with foreign keys. `run` mode provisions the fixtures (org 2, project B,
  project C — fixed IDs, plaintext legacy-format keys, `ON CONFLICT` safe)
  and defaults the keys; `probe` mode needs `-project-key-b`/`-project-key-c`.

Finding kinds: `status_diff` (status-class changes only, by default),
`body_shape_diff`, `body_value_diff` (success bodies only), `error_shape_diff`
(`-exact-status` mode only), `operation_missing`, `permission_leak`,
`permission_diff`, `mutation_not_visible`, `probe_failed`, `skipped`
(unresolvable parameters), `unverified_shape` (coverage notes).
