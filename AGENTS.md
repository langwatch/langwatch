# Agent Guidelines

> **Purpose:** Behavioral corrections only—concrete mistakes LLMs repeat despite knowing principles.  
> **Curation:** Add only after 2+ occurrences. Delete rows that stop appearing. Keep <15 rows.  
> **Scope:** Domain-specific files (e.g., `langwatch/AGENTS.md`) inherit from root.

## General

| Common Mistake | Correct Behavior |
|----------------|------------------|
| Using "should" in test descriptions | Use action-based descriptions: `it("checks local first")` not `it("should check local first")` |
| Skipping test run after edits | Always run tests after any code change to catch regressions immediately |
| Using undefined symbols without imports | Verify all symbols are imported before using them; run tests to catch `ReferenceError` |
| Duplicating logic across languages/templates | Business logic lives in one place; templates consume pre-computed values |

## TypeScript

| Common Mistake | Correct Behavior |
|----------------|------------------|
| Putting method-specific options interfaces in `types.ts` | Options interfaces belong in the file that uses them (e.g., `GetPromptOptions` in `prompts.facade.ts`) |
| Creating shared types for single-use interfaces | Colocate interfaces with their usage; only extract to `types.ts` when shared across multiple files |


