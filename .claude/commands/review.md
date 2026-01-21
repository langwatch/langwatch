# Review

Perform a comprehensive code review based on change content.

## Workflow

1. **Analyze changes**: Run `git diff main...HEAD --name-only` to see what files changed

2. **Route to reviewers**:
   - If test files changed (`.spec.ts`, `.test.ts`, `agentic-e2e-tests/`, `__tests__/`, `tests/`):
     → Invoke **test-reviewer** first for test-specific feedback
   - Always invoke **uncle-bob-reviewer** for all code changes

3. **Post-review**:
   - Check if any ADRs in `docs/adr/` need updating based on the changes
   - Verify PR description is still accurate and update if needed

## Notes

- test-reviewer focuses on: pyramid placement, locator quality, flakiness, test naming
- uncle-bob-reviewer focuses on: SOLID, clean code, architecture, design patterns
- No overlap — each reviewer has distinct concerns
