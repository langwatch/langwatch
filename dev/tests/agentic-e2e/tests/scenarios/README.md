# Agent Testing Feature Tests

E2E tests for the Agent Testing pages: the scenarios tab, the scenario editor
and the run dialog.

## Source Feature Files

These tests implement scenarios from:

- `specs/features/agent-testing/page-structure.feature`
- `specs/features/agent-testing/cases-table.feature`
- `specs/features/agent-testing/run-dialog.feature`

## Test Files

| File                         | Feature         | Tests                                                                                 |
| ---------------------------- | --------------- | ------------------------------------------------------------------------------------- |
| `steps.ts`                   | -               | Shared Gherkin-style step definitions                                                 |
| `scenario-library.spec.ts`   | Page structure  | Title and tabs, the scenarios panel, the redirect from a saved `/simulations` address |
| `scenario-editor.spec.ts`    | Scenario editor | Create, edit, workflow lifecycle, criteria                                            |
| `scenario-execution.spec.ts` | Run dialog      | Results tab, Save & Run                                                               |

## Architecture

### Day zero

A fresh project holds no agent, no test suite and no scenario. The page asks
for them in that order: **Setup agent**, then **Name your first test suite**,
then **New scenario**. The steps `givenTheProjectHasAnAgent` and
`givenTheProjectHasATestSuite` create each one only when its empty state is on
screen, so the same test runs against the empty CI project and against a
project that already holds data.

The agent the steps create is an HTTP agent with an address that does not
answer. A run against it fails, and the run drawer shows that failure as a
result, which is enough for the tests.

### Step Definitions (`steps.ts`)

All step functions follow Gherkin naming conventions:

```typescript
// Given steps - set up preconditions
export async function givenIAmOnTheScenariosPage(page: Page) { ... }
export async function givenICanWriteAScenario(page: Page) { ... }

// When steps - perform actions
export async function whenIClickNewScenario(page: Page) { ... }
export async function whenIFillInTitleWith(page: Page, title: string) { ... }
export async function whenIClickSave(page: Page) { ... }

// Then steps - verify outcomes
export async function thenISeeTheScenarioEditor(page: Page) { ... }
export async function thenScenarioAppearsInList(page: Page, title: string) { ... }
```

### Locators

The Agent Testing components carry `data-testid` attributes, and the editor
fields carry `aria-label`s (`Title`, `Situation`, `Criteria`). Prefer those
over text. Chakra renders duplicate dialog elements for responsive design, so
steps use `.last()` for fields inside a drawer.

### Workflow Test Pattern

The `scenario lifecycle` test combines several feature scenarios:

```
1. Save new scenario
2. Verify in list
3. Click the row to edit
4. Load existing data
5. Update the title
6. Verify the update in the list
```

This avoids seeded data and tests a real user journey in one self-contained
test.

### Runs without a model provider

CI has no model provider. `Save & Run` opens the run dialog, the test picks
the first agent and clicks Run, and the platform refuses the run: the dialog
then reads "No model provider is set up" in place of a queued run. The
execution test accepts that notice or the run drawer, and with a provider it
waits for the run to show in the drawer.

## Adding New Tests

1. Find the scenario in `specs/features/agent-testing/*.feature`.
2. Add step functions to `steps.ts` with Gherkin naming.
3. Compose them in the matching `.spec.ts` file.
4. Add a doc comment naming the feature file the test binds.

## Troubleshooting

### "strict mode violation: resolved to N elements"

Chakra renders duplicates. Use `.first()` or `.last()`.

### Save does not close the drawer

The drawer closes itself after the "Scenario created" or "Scenario updated"
toast. Wait for the toast, then for the Title field to disappear, as
`whenIClickSave` does.

### The test creates an agent or a suite that already exists

The day zero steps act only when the matching empty state is visible. A
project that already holds an agent and a suite skips both.
