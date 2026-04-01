# Review

Perform a comprehensive code review based on change content.

## Workflow

1. **Analyze changes**: Run `git diff main...HEAD --name-only` to see what files changed

2. **Route to reviewers**:
   - Always invoke **principles-reviewer** for design quality (SRP, readability, simplicity)
   - Always invoke **hygiene-reviewer** for codebase fit (reuse, patterns, idioms)
   - Always invoke **security-reviewer** for security scan (secrets, PII, sensitive data)
   - If test files changed (`.spec.ts`, `.test.ts`, `agentic-e2e-tests/`, `__tests__/`, `tests/`):
     → Also invoke **test-reviewer** for test-specific feedback

3. **Post-review**:
   - Check if any ADRs in `dev/docs/adr/` need updating based on the changes
   - Verify PR description is still accurate and update if needed

## Notes

- principles-reviewer focuses on: SRP, readability, simplicity, extensibility, CUPID properties
- hygiene-reviewer focuses on: reuse, pattern consistency, idioms, dead code, boy scout rule
- security-reviewer focuses on: PII exposure, hardcoded secrets, sensitive data in logs/tests
- test-reviewer focuses on: pyramid placement, coverage, naming, test data quality
- No overlap — each reviewer has distinct concerns
