# BDD Workflow

The standard workflow for feature development in LangWatch.

## 1. Challenge & Clarify

- Question ambiguity, missing edge cases, unstated requirements
- Provide options and recommend the best one
- Don't assume—ask before proceeding

## 2. Define the Feature

A **Feature** is a user-facing capability, not a milestone or implementation task.

**Good:** `scenario-library.feature`, `prompt-editor.feature`
**Bad:** `walking-skeleton.feature`, `m1-tasks.feature`

If the request spans multiple capabilities, create separate feature files.

## 3. Propose Spec

- Draft a `.feature` file in the `specs/` directory
- Use **only** these tags: `@e2e`, `@component`, `@integration`, `@unit`
- Scenarios must be user/domain-focused
- **One invariant per scenario**
- Present for approval. **Do NOT write code yet.**

### Tag Guidelines

| Tag | When to Use | Tested By |
|-----|-------------|-----------|
| `@e2e` | Multi-page user journeys | Playwright (agentic) |
| `@component` | React component behavior, hooks | React Testing Library |
| `@integration` | API orchestration, services | Vitest |
| `@unit` | Pure logic, isolated functions | Vitest |

**Never use:** `@visual`, `@manual`, `@skip`, `@pending`

## 4. Outside-In TDD (after approval)

For `@integration` and `@unit`:
1. Write failing tests
2. RED → GREEN → REFACTOR
3. Verify: `pnpm typecheck && pnpm lint && pnpm test`

For `@e2e`:
1. Use `playwright-test-planner` to create test plan
2. Use `playwright-test-generator` to write `.spec.ts`
3. `playwright-test-healer` maintains tests as app evolves

## Do NOT Test

- Type definitions
- Simple pass-throughs with no logic
- Third-party internals
- Static config

## References

- `TESTING.md` - Full testing philosophy
- `agentic-e2e-tests/README.md` - E2E infrastructure
