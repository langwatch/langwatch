# Agent Guidelines

> **Purpose:** Behavioral corrections only—concrete mistakes LLMs repeat despite knowing principles.  

## General

| Common Mistake | Correct Behavior |
|----------------|------------------|
| Using "should" in test descriptions | Use action-based descriptions: `it("checks local first")` not `it("should check local first")` |
| Skipping test run after edits | Always run tests after any code change to catch regressions immediately |
| Using undefined symbols without imports | Verify all symbols are imported before using them; run tests to catch `ReferenceError` |
| Duplicating logic across languages/templates | Business logic lives in one place; templates consume pre-computed values |
| Implementing code before writing tests | Follow Outside-In TDD: Write failing tests first, then implement minimal code to pass, then refactor |
| Writing tests in the incorrect order | Outside-In TDD: examples drive E2E tests => then integration tests => then unit tests |
| Editing existing database migrations | Never edit existing migrations; always create new migrations using CLI tools (e.g., `prisma migrate dev`) |

## TypeScript

| Common Mistake | Correct Behavior |
|----------------|------------------|
| Putting method-specific options interfaces in `types.ts` | Options interfaces belong in the file that uses them (e.g., `GetPromptOptions` in `prompts.facade.ts`) |
| Creating shared types for single-use interfaces | Colocate interfaces with their usage; only extract to `types.ts` when shared across multiple files |
| Using npm for package management | Always use pnpm instead of npm for all package management tasks |



