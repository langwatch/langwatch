# LangWatch

LLM Ops platform for evaluation, observability, and optimization of AI agents and pipelines.

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

- `docs/CODING_STANDARDS.md` - clean code, SOLID principles
- `docs/TESTING_PHILOSOPHY.md` - test hierarchy, BDD workflow
- `docs/best_practices/` - language/framework conventions
- `docs/adr/` - Architecture Decision Records

## General

| Common Mistake | Correct Behavior |
|----------------|------------------|
| Using "should" in test descriptions | Use action-based descriptions: `it("checks local first")` not `it("should check local first")` |
| Code before tests | Outside-In TDD: spec → test → code |
| Tests after TODO list | BDD specs come first |
| Shared types in `types.ts` | Colocate unless truly shared |
| Duplicating Zod + TS types | Zod only, use `infer` |
| Skipping test run after edits | Always run tests after any code change to catch regressions immediately |
| Duplicating a type definition in Zod for types that will also be used on the backend | Shared types that require validation should be defined in Zod only and use infer to get the typescript type to avoid duplication and getting them out of sync |
| Implementing code before writing tests | Follow Outside-In TDD: Write failing tests first, then implement minimal code to pass, then refactor |
| Writing tests in the incorrect order | Outside-In TDD: examples drive E2E tests => then integration tests => then unit tests |
| Defining BDD specs on the end of the TODO list | BDD specs should come before any other tasks to guide them, not the other way around |
| `gh pr edit --body` | Use `gh api repos/OWNER/REPO/pulls/N -X PATCH -f body="..."` (avoids Projects classic deprecation warning) |

## TypeScript

| Common Mistake | Correct Behavior |
|----------------|------------------|
| Using npm tsc to compile | Use `pnpm typecheck` instead, it uses the new tsgo which is much faster |
| Creating shared types for single-use interfaces | Colocate interfaces with their usage; only extract to `types.ts` when shared across multiple files |
| Using -- on pnpm tasks, pnpm adds the -- automatically | Using e.g. `pnpm test:unit path/to/file` directly |

## Orchestration Model

Implementation tasks use an opt-in orchestrator pattern:
- `/orchestrate` - Explicit orchestration mode for any requirements
- `/implement #123` - Entry point for GitHub issues (invokes `/orchestrate`)
- `.claude/agents/coder.md` - Implementation agent
- `.claude/agents/uncle-bob-reviewer.md` - Review agent

The orchestrator holds requirements in todos and delegates code work to agents via `/plan` → `/code` → `/review` loop.
