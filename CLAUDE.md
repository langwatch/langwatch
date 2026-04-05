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

From repo root (requires Docker):

```bash
make dev              # Minimal: postgres + redis + app
make dev-scenarios    # + workers (includes scenarios) + bullboard + ai-server + nlp
make dev-full         # Everything including opensearch
make quickstart       # Interactive profile chooser
make down             # Stop all services
```

See `dev/docs/adr/004-docker-dev-environment.md` for architecture decisions.

## Commands

Inside langwatch/

```bash
pnpm typecheck        # Type check (uses tsgo, fast)
pnpm test:unit        # Unit tests
pnpm test:integration # Integration tests
pnpm test:e2e         # E2E tests
```

## Structure

```
langwatch/           # Next.js app (main product)
langwatch_nlp/       # Python NLP service
langwatch_server/    # Python server
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
| Getting "Cannot find module" errors for generated files (.prisma/client, types.generated, evaluators.generated) | Run `pnpm start:prepare:files` in the `langwatch/` directory to regenerate all generated types (Prisma, Zod, SDK versions, langevals). This is needed after fresh clones, worktree creation, or any schema changes |
