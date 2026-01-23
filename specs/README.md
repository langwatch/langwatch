# Specs

BDD feature files describing user-facing behavior.

## Before Implementing

1. Check if a feature file already exists for your area
2. Read the scenarios - they ARE the requirements
3. If no feature file exists, create one first

## What Makes a Good Feature File

A feature file should be a **complete specification** of the work:

### Feature Complete
- All acceptance criteria from the issue are captured as scenarios
- All user-visible behaviors are described
- No gaps - if it's not in the feature file, it's not in scope

### Non-Overlapping Test Coverage
Each test level has a distinct purpose (see `docs/TESTING_PHILOSOPHY.md`):

| Tag | Purpose | What It Tests |
|-----|---------|---------------|
| `@e2e` | Happy paths via real examples | Full system, no mocks |
| `@integration` | Edge cases, error handling | Module boundaries, external services mocked |
| `@unit` | Pure logic, branches | Single function/class, collaborators mocked |

**Avoid overlap**: If an E2E test covers the happy path, don't duplicate it in integration. Integration tests edge cases. Unit tests logic branches.

### Scenario Design
- One invariant per scenario
- Scenarios should be independent
- Focus on behavior, not implementation
- "When I run a scenario, traces appear" not "spawn child process with env vars"

## What Goes Here

- Observable behavior, not implementation details
- User stories, not technical architecture
- Complete coverage plan with appropriate test levels

See `docs/TESTING_PHILOSOPHY.md` for detailed testing workflow and decision tree.
