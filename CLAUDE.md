# LangWatch

LLM Ops platform for evaluation, observability, and optimization of AI agents and pipelines.

## Before You Implement Anything

**Check `specs/` first.** Feature files ARE the requirements.

```
ls specs/                    # Find relevant subdirectory
cat specs/foo/bar.feature    # Read the scenarios
```

If no feature file exists for your task, create one before writing code.

## Development Environment

`make quickstart` is the single entry point. It asks what you're working on and starts only the services you need, overriding only the URLs whose services are local. Your `langwatch/.env` is the source of truth for everything else.

```bash
make quickstart                        # Interactive preset picker
make quickstart all-local              # Local CH + PG + Redis + app + workers, no NLP (fast iteration default)
make quickstart all-local-nlp          # all-local + nlpgo + langevals
make quickstart dev-storage            # Local DBs + workers, stored-objects -> dev S3 (runtime-storage-dev)
make quickstart dev-infra              # Local app + redis + workers compose; shared dev for PG/CH/NLP/S3
make quickstart frontend-only          # No compose, fastest — UI / design work
make quickstart migration              # postgres + clickhouse on host ports for prisma migrate (no app, no workers)
make quickstart full-local             # Kitchen-sink local: all-local-nlp + dedicated workers container + bullboard + ai-server
make quickstart-help                   # Non-interactive preset reference
make down                              # Stop all services
make service svc=aigateway             # Start the Go AI Gateway data plane on :5563
make help                              # Full target list including boxd workflows
```

The preset-picker writes `langwatch/.env.dev-up` listing only the URLs to override; everything else comes from your `langwatch/.env`. **Credentials never go in the overlay** — only non-rotating infrastructure shape (bucket / endpoint / region / connection-host). For `dev-storage`, refresh AWS SSO credentials in `.env` first via `bash langwatch/scripts/refresh-dev-s3-env.sh` (the launcher hard-fails without S3_SESSION_TOKEN).

The legacy `make dev` / `make dev-nlp` / `make dev-scenarios` / `make dev-test` / `make dev-full` aliases were removed in #4053. Use the preset names directly. `make dev-up` / `make dev-down` / `make dev-logs` still exist for per-worktree isolated stacks (the `dev-up.sh` use case — separate from `quickstart`).

Stateful services (`langwatch-db-data`, `langwatch-clickhouse-data`, `langwatch-redis-data`) share data across worktrees: sign up once, persist across worktree switches. Only one worktree can have postgres or clickhouse `up` at a time — `quickstart` detects collisions and points at the other compose project. Redis is a singleton on host `:6379`.

For per-PR / per-issue cloud environments via boxd, see `dev/docs/boxd-makefile.md` and `make boxd-help`.

See `dev/docs/adr/004-docker-dev-environment.md` for architecture decisions.

### AI Gateway (Go, services/aigateway/)

The gateway is a separate Go service (not in `compose.dev.yml`) that terminates
virtual-key traffic, fans out to providers via Bifrost, and reports usage back to
the control plane. `pnpm dev` auto-starts it alongside vite + api when the Go
toolchain is on PATH; the process appears as `gateway` in the concurrent output
and reuses an existing listener on :5563 if another worktree already booted one.
Set `LANGWATCH_SKIP_AIGATEWAY=1` to opt out (e.g. TS-only contributors). To run
the gateway standalone:

```bash
make service svc=aigateway       # run once
make service-watch svc=aigateway # live reload via air
```

Requires `langwatch/.env` with `LW_GATEWAY_INTERNAL_SECRET`,
`LW_GATEWAY_JWT_SECRET`, and `LW_GATEWAY_BASE_URL` set — see the
"AI GATEWAY" block at the bottom of `langwatch/.env.example`. Generate
secrets with `openssl rand -hex 32`. The Go gateway and the TS
control-plane both source the same `.env`, so each secret lives in
exactly one place (no prefix duplication). Set
`FEATURE_FLAG_FORCE_ENABLE=release_ui_ai_gateway_menu_enabled` to unhide the UI.

## Commands

Inside langwatch/

```bash
pnpm typecheck        # Type check (uses tsgo, fast)
pnpm test:unit        # Unit tests
pnpm test:integration # Integration tests
pnpm test:e2e         # E2E tests
```

When debugging locally, `pnpm dev` may tee output to `langwatch/server.log` — check it with `grep` if available.

## Structure

```
langwatch/           # Next.js app (main product)
langwatch_server/    # Python server
services/nlpgo/      # Go NLP engine (:5561, built as langwatch/langwatch_nlp)
services/aigateway/  # Go AI Gateway data plane (:5563)
charts/gateway/      # Helm sub-chart for the gateway
python-sdk/          # Python SDK
typescript-sdk/      # TypeScript SDK
specs/               # BDD feature specs
```

## Key References

- `dev/docs/CODING_STANDARDS.md` - clean code, SOLID + CUPID principles
- `dev/docs/TESTING_PHILOSOPHY.md` - test hierarchy, BDD workflow
- `dev/docs/best_practices/` - language/framework conventions
- `dev/docs/adr/` - Architecture Decision Records

## General

| Common Mistake | Correct Behavior |
|----------------|------------------|
| Building from scratch without checking existing code | Search the codebase first - follow existing patterns, extend existing systems, reuse existing abstractions |
| Building settings UI without reading the UX guidelines | Read `dev/docs/best_practices/` first (`scope-selector-and-badges.md`, `drawers.md`, `row-actions-overflow-menu.md`, `scoped-resources.md`). Scope selection ALWAYS uses `ScopeChipPicker` (multi-scope, `personalScopes` for personal-project variants), never a hand-rolled Select |
| Implementing without checking feature files | Check `specs/` for existing feature files first - they ARE the requirements. If none exists, create one before coding |
| Using "should" in test descriptions | Use action-based descriptions: `it("checks local first")` not `it("should check local first")` |
| Describe blocks without "when" context | Inner describe blocks must use "when" conditions: `describe("when user clicks submit", () => ...)` not `describe("submit behavior", ...)` |
| Flat test structure with GWT comments | Use nested `describe("given X")` and `describe("when Y")` blocks for BDD structure, not comments |
| Naming tests as unit when they render components | Tests that render components and mock boundaries are integration tests (`.integration.test.ts`), not unit tests |
| Writing string-assertion "regression tests" for runtime bugs | If the bug is a runtime crash/error, the regression test must execute the code path and observe the crash — not just assert the generated output string looks different. String checks are supplementary, not primary |
| Code before tests | Outside-In TDD: spec → test → code |
| Tests after TODO list | BDD specs come first |
| Shared types in `types.ts` | Colocate unless truly shared |
| Duplicating Zod + TS types | When you need both validation AND types, use Zod only with `infer`. For internal constants (no external input), `as const` is sufficient |
| Skipping test run after edits | Always run tests after any code change to catch regressions immediately |
| Writing tests in the incorrect order | Outside-In TDD: integration tests first, then unit tests |
| Defining BDD specs on the end of the TODO list | BDD specs should come before any other tasks to guide them, not the other way around |
| `gh pr edit --body` | Use `gh api repos/OWNER/REPO/pulls/N -X PATCH -f body="..."` (avoids Projects classic deprecation warning) |
| Inconsistent branch naming | Issue branches: `issue123/slug`, features: `feat/slug` |
| Feature file scenarios with implementation details like `settings.X equals Y` | Feature files describe behavior from user perspective, not config values or internals. Write "job fails without retry" not "settings.attempts equals 1" |
| Forgetting `projectId` in Prisma queries | Always include `projectId` in WHERE clauses for project-level models — the multitenancy middleware will reject queries without it |
| Duplicating legacy code into new locations with minor rewrites | Reuse the existing function via import, or refactor into a shared module. Do not copy-paste legacy tree-walking/utility code into mappers or services |
| Writing comments describing behavior that the code doesn't actually implement | If you write a comment like "extracts X from Y", the code must actually do that. Delete misleading comments, or implement what they promise |
| Re-exporting from a module for "backwards compatibility" | Never re-export — update the existing consumers to import from the new location directly |
| Using `gh api graphql -f`/`-F` variable parameters for GraphQL queries | Inline the values directly in the query string (replace `OWNER`, `REPO`, `NUMBER` literals). The `-f`/`-F` flags cause escaping issues with multiline queries and special characters |
| Using gpt-4o or gpt-4.1-mini in tests, scenarios, or fixtures | Always use `gpt-5-mini` — it's the cheapest and most capable model. Default to `openai("gpt-5-mini")` for scenario judges, user simulators, and test fixtures |
| Only verifying tests parse (CI=1) without running them end-to-end | Always run scenario tests end-to-end locally (`npx vitest run file.test.ts` without CI flag) to verify they actually pass with Claude Code |
| Returning JSX from hooks | Hooks return state and callbacks, never JSX. If a hook needs to "render" something (dialog, tooltip), return props/state and let the consumer render the component explicitly. Use `.ts` for hooks, `.tsx` for components |
| Using `form.watch()` in child components that receive `form` as a prop | Use `useWatch({ control: form.control, name: "field" })` instead — `form.watch()` doesn't trigger re-renders in child components (especially inside `useFieldArray` items). Only the form owner component should use `form.watch()` |
| Relying solely on `gh pr checks` to assess CI status | Use `gh run list --branch <branch>` to see all workflow runs — `gh pr checks` deduplicates by check name and can mask failing runs behind passing ones from earlier commits |
| Hono routes calling repositories directly | Routes must go through a service layer — never instantiate or import from repositories. Business logic (validation, guards) belongs in the service, not the route |
| Using `list` or `get` for repository methods | Repositories use `findAll`/`findById`. Services use `getAll`/`getById`. Routes call services only |
| Setting up a Monitor / sleep that *can* take more than 5 minutes | Anthropic's prompt cache TTL is 5min, so any wait that crosses it forces an uncached re-read of the full conversation on wake-up (slower + double-pays for tokens). Cap each poll cycle at **4.5 min (270s)** — re-check, then re-arm. If the work is obviously hours away (long deploy, overnight run), don't sit on a Monitor at all — drop it and hand control back to the user |
| Using inline `import("...")` anywhere | Never use inline `import()` — always use top-level `import` / `import type` statements |

## TypeScript

| Common Mistake | Correct Behavior |
|----------------|------------------|
| Using npm tsc to compile | Use `pnpm typecheck` instead, it uses the new tsgo which is much faster |
| Creating shared types for single-use interfaces | Colocate interfaces with their usage; only extract to `types.ts` when shared across multiple files |
| Using -- on pnpm tasks, pnpm adds the -- automatically | Using e.g. `pnpm test:unit path/to/file` directly |
| Using positional parameters for functions with multiple args | Use named parameters via object destructuring: `fn({ a, b })` not `fn(a, b)` |

## Database

**Read `dev/docs/best_practices/clickhouse-queries.md` before writing or modifying any ClickHouse query.**

| Common Mistake | Correct Behavior |
|----------------|------------------|
| Modifying deployed migrations | Never edit migrations that have been deployed - they are immutable history. Create a new migration instead. (New migrations not yet in production can be fixed before merging) |
| Hardcoding schema names in migrations | Use unqualified table names (e.g., `"Monitor"` not `"langwatch_db"."Monitor"`) - Prisma uses the schema from connection string |
| Writing ClickHouse queries without TenantId filtering | Every ClickHouse query MUST include `WHERE TenantId = {tenantId:String}` — no other ID (ScenarioRunId, BatchRunId, etc.) is unique across tenants. Always make TenantId the first predicate |
| Using `LIMIT 1 BY` with heavy columns in subqueries | Use the IN-tuple dedup pattern (`GROUP BY key + max(UpdatedAt)` in subquery). `LIMIT 1 BY` forces ClickHouse to materialize ALL selected columns for entire granules (~8K rows), causing OOM with heavy payloads (Messages, SpanAttributes, ComputedInput/Output) |
| Using `max(column)` for pagination sort keys on deduped tables | Use `argMax(column, UpdatedAt)` to derive sort keys from the latest version only. `max()` may pick values from stale versions, causing cursor pagination to skip/duplicate rows |
| Not filtering on the partition key column in WHERE | Always include `StartedAt`/`OccurredAt`/`StartTime` range in WHERE when a date range is available — this enables partition pruning. Without it, ClickHouse scans ALL partitions including cold storage on S3, turning 100ms queries into 1-2s |
| Writing down migrations in ClickHouse migration files | Always comment out down migrations to prevent accidental data loss. Add a note: "To roll back, uncomment and run manually" |
| Putting multiple ALTER TABLE statements in one StatementBegin block | ClickHouse does not support multi-statement queries. Each ALTER TABLE needs its own `-- +goose StatementBegin` / `-- +goose StatementEnd` block |
| Getting "Cannot find module" errors for generated files (.prisma/client, types.generated, evaluators.generated) | Run `pnpm start:prepare:files` in the `langwatch/` directory to regenerate all generated types (Prisma, Zod, SDK versions, langevals). This is needed after fresh clones, worktree creation, or any schema changes |
