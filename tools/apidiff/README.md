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
              [-dry-run] [-no-haven] [-pg-url URL -ch-url URL -redis-url URL]
              [-compose-project NAME] [probe flags...]

apidiff probe -a URL -b URL [-project-key KEY] [-org-key KEY] [-admin-key KEY]
              [-scim-key KEY] [-project-key-b KEY] [-project-key-c KEY]
              [-timeout DUR] [-settle-timeout DUR] [-path-prefix P]
              [-method M] [-exact-status] [-exclude-prefix P]... [-max-ops N]
              [-json] [-report FILE] [-ledger FILE] [-ledger-baseline FILE]
```

`run` boots both instances itself — a detached git worktree for `-main-ref`
(default `main`), and, wherever haven is selected, a second worktree checking
out `-branch-dir`'s own HEAD — with isolated Postgres/ClickHouse databases
(run-scoped: `apidiff_<runid>_branch` / `apidiff_<runid>_main`, where the run
id derives from the work-root name) and Redis logical DBs (14/15), migrates
and seeds each, waits for health, probes, and tears everything down. `probe`
compares two already-running instances.

**Neither haven stack ever boots inside the invoking checkout.** haven
registers one stack per directory: booting the branch instance in place used
to let `haven up` there replace a developer's own stack registration for that
directory, and the run's teardown `haven destroy` take it down with it (an
incident on 2026-09-10 — a developer's own stack vanished mid-session). The
branch side now checks out its own HEAD into `<work-root>/branch`, the same
way the base side has always checked out into `<work-root>/main`, and a run
refuses outright if either worktree path would resolve to the invoking
checkout. `-dry-run` prints the plan — both refs, both worktree paths, both
haven slugs, and the ordered commands a real run would issue — and starts
nothing at all: no worktree, no haven command, no install.

Exit status is `0` for no behavioral differences, `1` for differences found,
and `2` for operational or usage errors. With `-ledger-baseline`, only a
root cause the baseline does not name sets `1`. Progress (boot phases, per-operation
probing) streams to stderr; stdout carries only the deterministic summary, or
the machine report with `-json` (optionally to `-report FILE`).

## Boot details

- **Each instance is a haven stack** wherever `haven` is on PATH, under its own
  run-scoped slug (`apidiff-<run>-branch`, `apidiff-<run>-main`). haven gives
  each slug its own Postgres and ClickHouse database and its own Redis logical
  database, allocated against the ones live stacks hold, and does the install,
  codegen, migrate and seed itself - so `apidiff run` provisions nothing and a
  run can never reach the datastores the stack you are using sits on. Readiness
  is `haven status --json` reporting the stack's backend lane listening, and the
  instance is addressed on the API port haven allocated. `haven up` runs from
  each instance's own worktree — never from the invoking checkout, which is
  what a directory-registered stack must never share. Teardown is
  `haven destroy <slug>` for exactly those two slugs, run from the work root.
  `-no-haven` boots the old way; `-env-file` is refused alongside haven,
  because pointing the instances at the servers a dotenv names is the thing
  haven exists to stop.
- The paths below describe `-no-haven`. Each worktree boots through a detected profile: `apps/api`
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
- Before the first install, `apidiff run` **preflights** external
  infrastructure: all three URLs are parsed, the Postgres one must carry a
  username (psql falls back to `$USER`, prisma does not — the failure is a
  `P1010` eight minutes and two installs later), and each endpoint is dialled
  (Postgres `SELECT 1`, ClickHouse `SELECT 1`, Redis `PING`). Administrative
  statements run against the database `-pg-url` itself names; only the
  compose stack uses the `mydb` constant.
- Each instance gets its own **Redis logical database**, and both are emptied
  before the run and on teardown. The two indices are derived from the run id
  rather than fixed at 14/15, so two concurrent runs cannot collide and no
  previous run's queues, idempotency ledger or caches survive into the next
  one. (Measured before the fix: DB 15 still held 83 keys from the previous
  run while DB 14 was empty — an asymmetry the harness itself introduced.)
- After each side migrates, the run **asserts the migrate landed in this
  run's database** (`_prisma_migrations` is non-empty in
  `apidiff_<runid>_<side>`). The modular profile writes no env overlay and
  relies on node's `--env-file` not overriding an already-set variable; that
  is now an assertion rather than a comment. A URL that will not parse is an
  error too — never a silent fall back to the developer's own environment.
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
  `local-dev-team`), then IDs captured from earlier responses. Resolution
  happens **once per side, against that side's own symbol table**: each
  instance mints its own IDs, and one shared table sent the base's ID to the
  candidate and manufactured 404-vs-200 status differences. When only one
  side resolves, the operation is skipped with a reason naming that side
  (root cause `harness-symbol-table`) rather than probed as an asymmetric
  pair. Captured IDs are **typed** by the parameter they can satisfy — the
  response key they came under, and for a bare `id` the resource its own path
  names (`POST /api/prompts` files a `promptId`). There is no untyped
  catch-all: an operation whose `{promptId}` has no captured prompt ID is
  skipped, not probed with a trace ID.
- The union's probing definition (parameters, body schema, security) comes
  from the **candidate**, so an operation the branch changed is probed with
  the branch's shape; each side's own declared body is kept on the operation
  (`bodySchemaA` / `bodySchemaB`).
- **Collection verification** (after the main pass): when a mutation created
  an entity, every matching list GET (same path, or the GET path is an
  ancestor of the POST path) is re-probed and the entity must be VISIBLE in
  each side's list — `mutation_not_visible` when exactly one side loses it.
  The re-probe is an **event-driven settle**, never a fixed sleep: the list
  is re-read until the entity is visible on both sides or `-settle-timeout`
  (default 10s) passes, and the finding says how long it waited and for what.
  One side visible and the other not gets the whole timeout — that is the lag
  worth waiting out; neither side visible gets a quarter of it, because that
  is usually a collection the creation does not populate at all.
  Visible-on-both means the non-empty list shapes get compared, which is the
  real layout check. A list GET that answered 2xx with empty lists on both
  sides and had no mutation coverage is reported as `unverified_shape`
  (coverage note, never a difference, own section in the report).
- **Permission probes** (after the main pass): every project-key read is
  repeated with the sibling-project key (B: same org, wrong project) and the
  foreign-org key (C). The foreign request carries **only** the project-key
  header — an operation whose security also admits an organization bearer or
  an admin key is skipped rather than probed with the owner's second
  credential still attached, which used to make a legitimate success read as
  a leak. The leak candidates are the IDs the OWNER key saw on **that same
  operation**, minus the identities the foreign key legitimately owns (its
  own project, and the organization and team it sits in — shared and
  cascading scope is not a leak), and the finding **records the matched ID**.
  A denial class disagreement is a `permission_diff`; an operation that
  already differs on the owner key is skipped entirely, since replaying it
  with two foreign keys only re-reports the same root cause twice more.
  Mutations are never replayed with foreign keys.

  One class survives the rule: an endpoint that serves the same instance-wide
  document to every key (model defaults, providers) cannot be told apart,
  from its responses alone, from one that leaks to every key. Those are
  reported, and the recorded ID is what settles it on sight. `run` mode provisions the fixtures (org 2, project B,
  project C — fixed IDs, plaintext legacy-format keys, `ON CONFLICT` safe)
  and defaults the keys; `probe` mode needs `-project-key-b`/`-project-key-c`.

## The ledger

A run's `-report` is the evidence; the **ledger** is the worklist. Every
difference row carries a `rootCause`, a stable slug derived from the
finding's kind and the specific status pair, and the ledger groups rows by
it — so a report opens with `root causes: 13 causes across 41 operations`
instead of 78 rows to sort by hand. In the 2026-09-05 trial run that single
field collapses the 14 webhook rows into one
`handled-refusal-degraded:403-503` and groups the five not-found regressions
as one `not-found-as-500:404-500`.

`ledger.json` is written beside `-report`'s file automatically, or wherever
`-ledger FILE` says. Its shape:

```json
{
  "totals": { "unionOperations": 303, "probed": 275, "skipped": 4,
              "differingOperations": 41, "causes": 13,
              "newCauses": 2, "knownCauses": 11 },
  "causes": [ { "rootCause": "not-found-as-500:404-500", "kind": "status_diff",
                "count": 5, "operations": ["GET /api/prompts/{id}"],
                "known": false } ],
  "operations": [ { "method": "GET", "path": "/api/annotations",
                    "operationId": "listAnnotations", "presence": "both",
                    "cases": ["read"], "classification": "equal",
                    "rootCauses": [], "sideStatus": [200, 200],
                    "known": false } ]
}
```

There is **one row per operation in the union**, differing or not.
`classification` is a closed enum: `equal` · `equal-suppressed` · `differs` ·
`missing-a` · `missing-b` · `skipped` · `not-probed` · `unverified`.
`sideStatus` and every `[before, after]` pair read `[base, candidate]`.

Cause slugs: `not-found-as-500:<pair>`, `handled-refusal-degraded:<pair>`,
`server-error-resolved:<pair>`, `route-absent-on-candidate:<pair>`,
`route-absent-on-base:<pair>`, `status-class-mismatch:<pair>`,
`operation-missing-on-candidate`, `operation-missing-on-base`,
`permission-leak`, `permission-diff:<pair>`, `mutation-not-visible`,
`body-shape-diff`, `body-value-diff`, `error-shape-diff`, `probe-failed`,
`unresolvable-parameter`, `harness-symbol-table` (a harness artifact, not an
API difference), `unverified-list-shape`, and `spec-<change kind>`.

`-ledger-baseline FILE` takes a previous `ledger.json` (or a plain JSON array
of slugs) and marks those causes **known**: they are still reported, still
counted, and no longer fail the run. Only a cause the baseline does not name
exits `1`. That is how a branch ratchets from 40 causes to 0 without the tool
being red the whole way.

## Findings stream

`run` (not `probe`, which has no run directory) appends one JSON line to
`<work-root>/findings.jsonl` as each operation's comparison completes — a
reader can `tail -f` it during the run instead of waiting for the final
report and ledger. Each line is its own `Write`, flushed immediately, so
nothing is batched across findings:

```json
{"surface":"rest","name":"GET /api/prompts","kind":"identical","module":"prompt","detail":"","capturedAt":"2026-09-10T00:00:00Z"}
```

`surface` is `rest` or `trpc` (the latter reserved — see "Not covered"
below). `kind` is one of `absent-on-branch`, `status-differs`,
`shape-differs`, `identical`, `probe-failed`; a probe failure or a
missing-on-branch result wins over a mere status or shape difference. `module`
is the module directory under `modules/` that best-effort matches the
operation's path (a first path segment, singular/plural tolerant), or empty
when nothing matches — most of the REST surface predates the module layout,
so that is the common case. `detail` is one line: the status pair, the
changed field pointers, or the skip/failure reason. The stream closes with one
`{"kind":"run-complete","counts":{...}}` line totalling every kind emitted.

## Not covered

The ledger and the probes describe the **REST** surface only. The browser
talks to roughly a hundred tRPC procedures that the OpenAPI document does not
describe, so the tool sees none of them: a zero here is a REST zero. Closing
that needs a procedure manifest emitted from the tRPC chain (procedure path,
kind, input/output schema from the zod schemas, the declared access policy)
served beside `/api/openapi.json`, then probed in lockstep over the batch
link with the same ladder. That seam is deliberately left open.

No worker process is booted on either side, so anything whose observable
result depends on a queue, projection or scheduler is compared in a state
neither instance reaches in production.

Finding kinds: `status_diff` (status-class changes only, by default),
`body_shape_diff`, `body_value_diff` (success bodies only), `error_shape_diff`
(`-exact-status` mode only), `operation_missing`, `permission_leak`,
`permission_diff`, `mutation_not_visible`, `probe_failed`, `skipped`
(unresolvable parameters), `unverified_shape` (coverage notes).
