# ClickHouse in tests: an in-memory client for unit tests, testcontainers for integration

Research note, 2026-09-04. Alex asked for two things: bring testcontainers back
for integration tests only, and give unit tests a ClickHouse-shaped client that
needs no server, either a different repository implementation or a different
client. This note lays out what we have, the options, and a recommendation.
Numbers come from a survey of the branch today (50 ClickHouse repositories,
138 query sites, 36 insert sites, 664 bound parameters, 29 unit and 20
integration tests under `repositories/clickhouse/__tests__`).

## What we have

```
                 unit lane today                     integration lane today
  ┌──────────────────────────────────────┐   ┌─────────────────────────────────────┐
  │ 22 hand-rolled {query, insert} doubles│   │ TEST_CLICKHOUSE_URL / CI_CLICKHOUSE_URL│
  │ per test file, canned rows           │   │ + describe.skipIf(url === null)      │
  │ 23 files assert SQL substrings       │   │ 104 skipIf sites: silently skip on a │
  │ ("twin-drift pins")                  │   │ laptop with no ClickHouse configured │
  │ 0 shared helper                      │   │ 3 copies of clickhouse-endpoint.support│
  └──────────────────────────────────────┘   │ startTestClickHouseEndpoints (test-  │
                                             │ harness, testcontainers, tuned):     │
                                             │ 0 callers                            │
                                             └─────────────────────────────────────┘
```

Facts that shape the choice:

- **Every write goes through `client.insert({ table, values, format })`.**
  Not one repository issues `INSERT INTO` as SQL. Reads are the hard part:
  argMax (106 lines), IN-tuple dedup (150), GROUP BY (124), FINAL (24),
  PREWHERE, window functions, JSONExtract, uniqExact, toStartOf*, countIf,
  arrayJoin, ALTER TABLE DELETE mutations.
- **The nine feature ports are near-identical structural `{query, insert}`
  shapes** that differ only in the `clickhouse_settings` value type and
  `readonly` on values. One is the port itself with a single `query`. One
  (stored-object) adds `exec`. One (enterprise governance) leaks the vendor
  `ClickHouseClient` type.
- **The designed `QueryDriver` port in `packages/clickhouse-client` has zero
  adopters.** Repositories consume the wrapped vendor client.
- **The repository's own precedent for datastore doubles sits one level up.**
  Six shipped `repositories/memory/*.repository.ts` classes (scenario,
  experiment and suite each ship a memory twin beside their ClickHouse
  repository) and 47 test-local `Memory*`/`Fake*Repository` classes. Prisma is
  mocked four times in the whole tree.
- **What integration tests exist to catch** is documented at the support
  file: DDL to repository column drift, a real INSERT refusing a widened
  type, `system.query_log` assertions, mutation visibility, dedup under merge
  backlog. `clickhouse-queries.md:301` puts it bluntly: query-shape problems
  pass CI and grind production.
- `CI=1` already forces containers; testcontainers 12.1 and the tuned
  `TEST_CLICKHOUSE_IMAGE` 25.10.2.65 are already in `packages/test-harness`.
  Seven ClickHouse-touching packages have no integration lane at all.

## Options for the unit-test client

|     | Option                                   | What it is                                                                                                                                                                                                                         | Fidelity                                                                                                     | Cost                                                                                                                                                                                  | Verdict                                                                                        |
| --- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| A   | **chdb, embedded ClickHouse in-process** | `chdb` 3.3.0 (Aug 2026) ships ClickHouse 26.7 as a native N-API library; in-memory `Session`, sync and async query, `{name:Type}` server-side binding, INSERT and DDL, streaming. Linux and macOS x64/arm64, Node 18+. Apache-2.0. | Real engine: argMax, FINAL, PREWHERE, ReplacingMergeTree merges, all of it                                   | 342 MB optional dependency per platform, one data directory per process, no Windows, embedded version ahead of production (26.7 vs 25.10; older `@chdb/lib-*` versions can be pinned) | **Spike it.** It is the only thing that is honestly "a ClickHouse-esque client with no server" |
| B   | **Memory repositories at the port**      | `repositories/memory/memory.<x>.repository.ts` beside each `clickhouse.<x>.repository.ts`, shipped, lint-recognised; services unit-test against them; the ClickHouse repository is tested only in integration                      | Exact for service logic; the SQL is not exercised in the unit lane, by design                                | One memory twin per port a service unit test needs (not per repository: many ports are read by one service). Go's interface-plus-memory-impl pattern                                  | **Adopt as the rule** regardless of A                                                          |
| C   | **Real binary as a child process**       | Download the single `clickhouse` binary once (about 130 MB macOS, 200 MB Linux), run `clickhouse server` in a temp dir on a random port; `embedded-clickhouse` does this for Go, we would write the launcher                       | Real engine, real HTTP, real `goose` migrations                                                              | A launcher to own; still a server, not in-memory; overlaps with testcontainers                                                                                                        | Fallback for A if chdb cannot run our migrations; good for local dev without colima            |
| D   | **Hand-written SQL-evaluating fake**     | A TypeScript "mini ClickHouse" that parses our 138 query shapes                                                                                                                                                                    | Whatever subset we write; every gap is a test that passes while production differs                           | A SQL engine project, forever behind                                                                                                                                                  | **Reject**                                                                                     |
| E   | **DuckDB with the chsql extension**      | In-process DuckDB plus 100 ClickHouse macros                                                                                                                                                                                       | Dialect mismatch on the constructs we lean on (FINAL, PREWHERE, ReplacingMergeTree, settings, `{name:Type}`) | Two dialects to keep honest                                                                                                                                                           | **Reject**                                                                                     |

The failure mode to avoid is D in disguise: a client that answers most of our
SQL correctly is worse than one that answers none, because nobody can tell
which tests are proving anything. A test double for ClickHouse is either the
engine or nothing.

## Recommendation

```
   service unit tests            repository fast tests            integration
  ┌────────────────────┐        ┌──────────────────────┐        ┌────────────────────┐
  │ Memory*Repository  │        │ @langwatch/clickhouse│        │ testcontainers      │
  │ (port twin, shipped│        │ -memory: chdb behind │        │ ClickHouseContainer │
  │ under repositories/│        │ the {query, insert,  │        │ + goose migrations  │
  │ memory/)           │        │ exec} shape every    │        │ once per container, │
  │ no ClickHouse at   │        │ port accepts; DDL    │        │ real HTTP client,   │
  │ all                │        │ from the migrations  │        │ query_log, mutations│
  └────────────────────┘        └──────────────────────┘        └────────────────────┘
        *.unit.test.ts             *.unit.test.ts (repository)     *.integration.test.ts
```

1. **Rule for services: memory repositories (B).** Services never see a
   ClickHouse client in a unit test. Where a memory twin is missing, write it
   under `repositories/memory/`, shipped and unit-tested like
   `memory.suite-run.repository.ts`. This is the Go shape and the one the
   codebase already follows for Postgres.
2. **Spike chdb for repositories (A), one lane, two days, go or no-go.**
   Build `packages/clickhouse-memory` exporting `createMemoryClickHouse()`
   that returns a client satisfying every feature port's structural shape
   (query with `JSONEachRow`, insert with `values`, exec, the in-band
   `{"exception"}` guard), backed by a chdb in-memory `Session`, with the
   goose migrations applied at session start. The spike answers, in order:
   can the 88 migrations run (the runner creates a Replicated database and
   the tables may declare ReplicatedMergeTree, TTLs, materialised views and
   S3 storage policies; chdb has no keeper); does `{name:Type}` binding cover
   our 664 parameters (Array(String), DateTime64(3), Int64); does a
   ReplacingMergeTree round-trip with the IN-tuple dedup behave; what is the
   cold and warm cost per test file. Go means: the 29 repository unit tests
   drop their SQL-substring pins for real round-trips and the 22 doubles are
   deleted. No-go means C, or B alone with repositories tested only in
   integration.
3. **Unify the port shape first, whichever way the spike goes.** One
   `ClickHouseStatementClient` type in `packages/clickhouse-client` that the
   nine feature ports import as `import type` (types are erased, so the
   packages still do not depend on the driver at runtime), with one
   `clickhouse_settings` value type. Without this a shared fake has to satisfy
   nine slightly different shapes.
4. **Integration lane: testcontainers by default, native URL as the opt-in.**
   `startTestClickHouseEndpoints` becomes the one way an integration test
   gets ClickHouse; `LANGWATCH_TEST_CLICKHOUSE_URL` short-circuits it locally
   for people running native services; `CI=1` keeps forcing containers.
   Delete the three copies of `clickhouse-endpoint.support.ts` and every
   `describe.skipIf(url === null)`: an integration test that cannot get a
   database fails, it does not skip. Migrations run once per labelled,
   reused container through the existing goose task. Add `test:integration`
   lanes to the seven ClickHouse-touching packages that have none, and to
   `packages/clickhouse-client` itself so the goose runner and TTL reconciler
   stop being tested against `vi.mock("@clickhouse/client")`.
5. **Write the ADR once the spike lands**, citing ADR-093 (owned clients) and
   `specs/clickhouse/single-client-access.feature`: the memory client must
   reach repositories through the same port a production client does, so
   "a new bypass cannot be introduced unnoticed" keeps holding.

## Costs and risks worth saying out loud

- chdb adds a 342 MB native dependency to every install that runs tests. It
  is an `optionalDependencies` platform package, so a production image that
  installs with `--prod` never pulls it, but the developer and CI installs
  do. The install-time age gate that already skips optional dependencies
  (`optional-deps-silently-skipped-by-age-gate`) has to allow it or the
  package is silently absent and the memory client cannot load.
- Embedded version versus production version drift is real. Pin the
  `@chdb/lib-*` line to the nearest release of the production ClickHouse
  and bump it with the production upgrade, the way `TEST_CLICKHOUSE_IMAGE`
  is pinned today.
- One data directory per process: vitest's `vmForks` pool means one session
  per worker process, so tests in one file share a session and need
  per-test database names or table truncation. The spike measures this.
- Memory repositories drift from their ClickHouse twins unless both are
  driven by the same port contract test. The suite package already does
  this for one port; the rule should be one shared contract test per port
  run against both implementations.

## Sources

- chdb for Node.js: https://github.com/chdb-io/chdb-node and
  https://clickhouse.com/docs/chdb/install/nodejs (npm `chdb` 3.3.0,
  `@chdb/lib-darwin-arm64` 26.7.0-stable.1, 342 MB unpacked)
- Testcontainers ClickHouse module for Node:
  https://node.testcontainers.org/modules/clickhouse/ (12.1.0, already in
  `packages/test-harness`)
- Real binary as a child process, Go reference implementation:
  https://github.com/franchb/embedded-clickhouse
- DuckDB ClickHouse dialect macros:
  https://github.com/Query-farm/duckdb-extension-clickhouse-sql
