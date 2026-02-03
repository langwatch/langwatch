# LangWatch

LLM Ops platform for evaluation, observability, and optimization of AI agents and pipelines.

## Before You Implement Anything

**Check `specs/` first.** Feature files ARE the requirements.

```
ls specs/                    # Find relevant subdirectory
cat specs/foo/bar.feature    # Read the scenarios
```

If no feature file exists for your task, create one before writing code. If you are lost or have been implementing without checking specs, run `/refocus`.

## Development Environment

From repo root (requires Docker):

```bash
make dev              # Minimal: postgres + redis + app
make dev-scenarios    # + workers + scenario-worker + bullboard + ai-server + nlp
make dev-full         # Everything including opensearch
make quickstart       # Interactive profile chooser
make down             # Stop all services
```

See `docs/adr/004-docker-dev-environment.md` for architecture decisions.

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

- `docs/CODING_STANDARDS.md` - clean code, SOLID + CUPID principles
- `docs/TESTING_PHILOSOPHY.md` - test hierarchy, BDD workflow
- `docs/best_practices/` - language/framework conventions
- `docs/adr/` - Architecture Decision Records

## General

| Common Mistake | Correct Behavior |
|----------------|------------------|
| Building from scratch without checking existing code | Search the codebase first - follow existing patterns, extend existing systems, reuse existing abstractions |
| Implementing without checking feature files | Check `specs/` for existing feature files first - they ARE the requirements. If none exists, create one before coding |
| Using "should" in test descriptions | Use action-based descriptions: `it("checks local first")` not `it("should check local first")` |
| Describe blocks without "when" context | Inner describe blocks must use "when" conditions: `describe("when user clicks submit", () => ...)` not `describe("submit behavior", ...)` |
| Naming tests as unit when they render components | Tests that render components and mock boundaries are integration tests (`.integration.test.ts`), not unit tests |
| Code before tests | Outside-In TDD: spec → test → code |
| Tests after TODO list | BDD specs come first |
| Shared types in `types.ts` | Colocate unless truly shared |
| Duplicating Zod + TS types | When you need both validation AND types, use Zod only with `infer`. For internal constants (no external input), `as const` is sufficient |
| Skipping test run after edits | Always run tests after any code change to catch regressions immediately |
| Writing tests in the incorrect order | Outside-In TDD: examples drive E2E tests => then integration tests => then unit tests |
| Defining BDD specs on the end of the TODO list | BDD specs should come before any other tasks to guide them, not the other way around |
| `gh pr edit --body` | Use `gh api repos/OWNER/REPO/pulls/N -X PATCH -f body="..."` (avoids Projects classic deprecation warning) |
| Inconsistent branch naming | Issue branches: `issue123/slug`, features: `feat/slug`. Use `/worktree #123` for automatic naming |

## TypeScript

| Common Mistake | Correct Behavior |
|----------------|------------------|
| Using npm tsc to compile | Use `pnpm typecheck` instead, it uses the new tsgo which is much faster |
| Creating shared types for single-use interfaces | Colocate interfaces with their usage; only extract to `types.ts` when shared across multiple files |
| Using -- on pnpm tasks, pnpm adds the -- automatically | Using e.g. `pnpm test:unit path/to/file` directly |

## Database

| Common Mistake | Correct Behavior |
|----------------|------------------|
| Modifying deployed migrations | Never edit migrations that have been deployed - they are immutable history. Create a new migration instead. (New migrations not yet in production can be fixed before merging) |
| Hardcoding schema names in migrations | Use unqualified table names (e.g., `"Monitor"` not `"langwatch_db"."Monitor"`) - Prisma uses the schema from connection string |

## Orchestration Model

Implementation tasks use `/orchestrate` to manage the plan → code → review → e2e loop:

- `/orchestrate <requirements>` - Enter orchestration mode
- `/implement #123` - Fetch GitHub issue → invoke `/orchestrate`

The orchestrator:
1. **Creates a task checklist** using TaskCreate to map acceptance criteria
2. Delegates to `/plan` (self-contained), `/code` (coder agent), `/review` (uncle-bob-reviewer + cupid-reviewer agents in parallel)
3. **Verifies with E2E tests** via `/e2e` (if feature has `@e2e` scenarios)
4. Tracks progress via task status updates
5. Does NOT read or write code directly

See `.claude/README.md` for full orchestration documentation.

## E2E Testing Workflow

After code is implemented and reviewed, features with `@e2e` scenarios go through E2E verification:

```
/e2e specs/scenarios/my-feature.feature
    │
    ├── playwright-test-planner (Opus)
    │   - Explores live app at localhost:5570
    │   - Creates test plan in agentic-e2e-tests/plans/
    │
    ├── playwright-test-generator (Sonnet)
    │   - Generates Playwright tests from plan
    │   - Saves to agentic-e2e-tests/tests/
    │
    ├── playwright-test-healer (Sonnet)
    │   - Runs tests, fixes failures
    │   - Iterates until passing
    │
    └── test-reviewer (Opus)
        - Reviews test quality
        - Checks pyramid placement
```

**Run E2E tests manually:**
```bash
cd agentic-e2e-tests
docker compose up -d        # Start infrastructure
cd ../langwatch && PORT=5570 pnpm dev  # Start app
cd ../agentic-e2e-tests && pnpm test   # Run tests
```

See `agentic-e2e-tests/README.md` for detailed setup and conventions.
