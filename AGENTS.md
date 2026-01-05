# Agent Guidelines

> **Purpose:** Behavioral corrections only—concrete mistakes LLMs repeat despite knowing principles.

## General

| Common Mistake | Correct Behavior |
|----------------|------------------|
| Using "should" in test descriptions | Use action-based descriptions: `it("checks local first")` not `it("should check local first")` |
| Skipping test run after edits | Always run tests after any code change to catch regressions immediately |
| Using undefined symbols without imports | Verify all symbols are imported before using them; run tests to catch `ReferenceError` |
| Duplicating logic across languages/templates | Business logic lives in one place; templates consume pre-computed values |
| Duplicating a type definition in Zod for types that will also be used on the backend | Shared types that require validation should be defined in Zod only and use infer to get the typescript type to avoid duplication and getting them out of sync |
| Implementing code before writing tests | Follow Outside-In TDD: Write failing tests first, then implement minimal code to pass, then refactor |
| Writing tests in the incorrect order | Outside-In TDD: examples drive E2E tests => then integration tests => then unit tests |
| Defining BDD specs on the end of the TODO list | BDD specs should come before any other tasks to guide them, not the other way around |

## TypeScript

| Common Mistake | Correct Behavior |
|----------------|------------------|
| Using npm tsc to compile | Use `pnpm typecheck` instead, it uses the new tsgo which is much faster |
| Putting method-specific options interfaces in `types.ts` | Options interfaces belong in the file that uses them (e.g., `GetPromptOptions` in `prompts.facade.ts`) |
| Creating shared types for single-use interfaces | Colocate interfaces with their usage; only extract to `types.ts` when shared across multiple files |


