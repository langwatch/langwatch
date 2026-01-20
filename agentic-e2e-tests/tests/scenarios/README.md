# Scenario Feature Tests

E2E tests for the Scenario feature (Library, Editor, Execution).

## Source Feature Files

These tests implement scenarios from:
- `specs/scenarios/scenario-library.feature`
- `specs/scenarios/scenario-editor.feature`
- `specs/scenarios/scenario-execution.feature`

## Test Files

| File | Feature | Tests |
|------|---------|-------|
| `steps.ts` | - | Shared Gherkin-style step definitions |
| `scenario-library.spec.ts` | Library | Navigation, empty state |
| `scenario-editor.spec.ts` | Editor | Create, edit, workflow lifecycle |
| `scenario-execution.spec.ts` | Execution | Page loads, content display |

## Architecture

### Step Definitions (`steps.ts`)

All step functions follow Gherkin naming conventions:

```typescript
// Given steps - set up preconditions
export async function givenIAmOnTheScenariosListPage(page: Page) { ... }
export async function givenIAmLoggedIntoProject(page: Page) { ... }

// When steps - perform actions
export async function whenIClickNewScenario(page: Page) { ... }
export async function whenIFillInNameWith(page: Page, name: string) { ... }
export async function whenIClickSave(page: Page) { ... }

// Then steps - verify outcomes
export async function thenISeeTheScenarioEditor(page: Page) { ... }
export async function thenScenarioAppearsInList(page: Page, name: string) { ... }
```

### Chakra UI Considerations

Chakra UI renders duplicate dialog elements for responsive design. Steps use `.last()` to target the visible (topmost) dialog:

```typescript
// Use .last() for elements inside dialogs
await page.getByRole("textbox", { name: "Name" }).last().fill("...");
await page.getByRole("button", { name: /save/i }).last().click();
```

### Workflow Test Pattern

The `scenario lifecycle` test combines multiple feature scenarios:

```text
┌─────────────────────────────────────────────────────────────────┐
│  Workflow: scenario lifecycle                                   │
├─────────────────────────────────────────────────────────────────┤
│  1. Save new scenario        (scenario-editor.feature:30-39)    │
│  2. Verify in list           (scenario-library.feature)         │
│  3. Click to edit            (scenario-library.feature:34-38)   │
│  4. Load existing data       (scenario-editor.feature:45-52)    │
│  5. Update scenario          (scenario-editor.feature:54-59)    │
│  6. Verify update in list    (scenario-library.feature)         │
└─────────────────────────────────────────────────────────────────┘
```

This approach:
- Avoids needing seeded data (no scenario API exists)
- Tests a real user journey
- Each step builds on the previous one
- Single self-contained test

## Adding New Tests

### 1. Check the Feature File

Look in `specs/scenarios/*.feature` for the scenario to implement:

```gherkin
@e2e
Scenario: Filter scenarios by label
  Given scenarios exist with various labels
  When I select label "support" in the filter
  Then I only see scenarios with the "support" label
```

### 2. Add Step Functions (if needed)

Add to `steps.ts` using Gherkin naming:

```typescript
export async function whenISelectLabelFilter(page: Page, label: string) {
  await page.getByRole("button", { name: /labels/i }).click();
  await page.getByRole("checkbox", { name: new RegExp(label, "i") }).click();
}

export async function thenIOnlySeeScenariosWith(page: Page, label: string) {
  const rows = page.getByRole("row").filter({ hasText: new RegExp(label, "i") });
  await expect(rows.first()).toBeVisible();
}
```

### 3. Write the Test

Add to the appropriate `.spec.ts` file:

```typescript
/**
 * Scenario: Filter scenarios by label
 * Source: scenario-library.feature lines 51-55
 *
 * Note: Requires scenarios with labels to exist.
 * Consider adding to the workflow test or creating seeding support.
 */
test("filter scenarios by label", async ({ page }) => {
  await givenIAmOnTheScenariosListPage(page);
  await whenISelectLabelFilter(page, "support");
  await thenIOnlySeeScenariosWith(page, "support");
});
```

### 4. Document the Mapping

Add a doc comment linking to the feature file with line numbers.

## Test Data Strategies

### Option 1: Workflow Tests (Current)
Combine create → use → verify into one test. Best when:
- No API exists for creating test data
- Testing a natural user flow
- Data from one step is needed by the next

### Option 2: API Seeding (Future)
Create data via API in `beforeAll`. Best when:
- API endpoints exist
- Need isolation between tests
- Testing specific scenarios in isolation

### Option 3: Database Seeding (Future)
Insert data directly via Prisma. Best when:
- Need complex data setups
- API doesn't support all fields
- Performance is critical

## Troubleshooting

### "strict mode violation: resolved to N elements"
Chakra renders duplicates. Use `.first()` or `.last()`:
```typescript
await page.getByRole("dialog").last().getByRole("button").click();
```

### Test timing out on save
The "Save and Run" button opens a popover. Click "Save without running":
```typescript
await page.getByRole("button", { name: /save and run/i }).last().click();
await page.getByText("Save without running").last().click();
```

### Element not found in dialog
Wait for the dialog heading first:
```typescript
await expect(page.getByRole("heading", { name: /create scenario/i }).last()).toBeVisible();
```
