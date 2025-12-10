# Agent Guidelines for TypeScript SDK

## Common Mistakes | Correct Behavior

| Common Mistake | Correct Behavior |
|----------------|------------------|
| Putting method-specific options interfaces in `types.ts` | Options interfaces belong in the file that uses them (e.g., `GetPromptOptions` in `prompts.facade.ts`) |
| Using "should" in test descriptions | Use action-based descriptions: `it("checks local first")` not `it("should check local first")` |
| Creating shared types for single-use interfaces | Colocate interfaces with their usage; only extract to `types.ts` when shared across multiple files |
| Skipping test run after edits | Always run tests after any code change to catch regressions immediately |
| Using undefined symbols without imports | Verify all symbols are imported before using them; run tests to catch `ReferenceError` |


