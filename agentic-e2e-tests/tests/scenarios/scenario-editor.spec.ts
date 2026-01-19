import { test, expect } from "@playwright/test";

/**
 * Feature: Scenario Editor
 * Source: specs/scenarios/scenario-editor.feature
 *
 * As a LangWatch user
 * I want to create and edit scenario specifications
 * So that I can define behavioral test cases for my agents
 *
 * These tests specify the V1 Scenario Editor UI (3-Part Spec).
 * Tests marked with test.fixme() will fail until the feature is implemented.
 */

test.describe("Scenario Editor", () => {
  // Background: logged into project
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page).not.toHaveURL(/\/auth\//);
  });

  // Helper to navigate to scenarios list
  async function goToScenariosList(page: import("@playwright/test").Page) {
    await page.getByRole("link", { name: "Simulations", exact: true }).click();
    await expect(page).toHaveURL(/simulations/);
  }

  // ===========================================================================
  // Create Scenario
  // ===========================================================================

  // FIXME: V1 Scenario Editor UI not implemented - "New Scenario" button doesn't exist yet
  test.fixme("navigate to create form", async ({ page }) => {
    // Given I am on the scenarios list page
    await goToScenariosList(page);

    // When I click "New Scenario"
    await page.getByRole("button", { name: /new scenario/i }).click();

    // Then I navigate to the scenario editor
    await expect(page).toHaveURL(/simulations\/new|scenarios\/create/);

    // And I see an empty scenario form
    const nameField = page.getByLabel(/name/i);
    await expect(nameField).toBeVisible();
    await expect(nameField).toHaveValue("");
  });

  // FIXME: V1 Scenario Editor UI not implemented - form fields don't exist yet
  test.fixme("view scenario form fields", async ({ page }) => {
    // When I am on the create scenario page
    await goToScenariosList(page);
    await page.getByRole("button", { name: /new scenario/i }).click();

    // Then I see the following fields:
    // | field     | type              |
    // | Name      | text input        |
    const nameField = page.getByLabel(/name/i);
    await expect(nameField).toBeVisible();

    // | Situation | textarea          |
    const situationField = page.getByLabel(/situation/i);
    await expect(situationField).toBeVisible();

    // | Criteria  | list (add/remove) |
    const criteriaSection = page.getByText(/criteria/i);
    await expect(criteriaSection).toBeVisible();
    const addCriterionButton = page.getByRole("button", {
      name: /add criterion/i,
    });
    await expect(addCriterionButton).toBeVisible();

    // | Labels    | tag input         |
    const labelsField = page.getByLabel(/labels/i);
    await expect(labelsField).toBeVisible();
  });

  // FIXME: V1 Scenario Editor UI not implemented - create/save flow doesn't exist yet
  test.fixme("save new scenario", async ({ page }) => {
    // Given I am on the create scenario page
    await goToScenariosList(page);
    await page.getByRole("button", { name: /new scenario/i }).click();

    // When I fill in "Name" with "Refund Request Test"
    await page.getByLabel(/name/i).fill("Refund Request Test");

    // And I fill in "Situation" with description
    await page
      .getByLabel(/situation/i)
      .fill("User requests a refund for a defective product");

    // And I add criterion "Agent acknowledges the issue"
    await page.getByLabel(/criterion/i).fill("Agent acknowledges the issue");
    await page.getByRole("button", { name: /add criterion/i }).click();

    // And I add criterion "Agent offers a solution"
    await page.getByLabel(/criterion/i).fill("Agent offers a solution");
    await page.getByRole("button", { name: /add criterion/i }).click();

    // And I click "Save"
    await page.getByRole("button", { name: /save/i }).click();

    // Then I navigate back to the scenarios list
    await expect(page).toHaveURL(/simulations(?!\/new)/);

    // And "Refund Request Test" appears in the list
    const scenarioRow = page.getByRole("row", { name: /refund request test/i });
    await expect(scenarioRow).toBeVisible();
  });

  // ===========================================================================
  // Edit Scenario
  // ===========================================================================

  // FIXME: V1 Scenario Editor UI not implemented - edit flow doesn't exist yet
  // Also needs API seeding for test data
  test.fixme("load existing scenario for editing", async ({ page }) => {
    // Given scenario "Refund Flow" exists (seeded via API)
    // TODO: Seed scenario via API before test

    // When I navigate to edit "Refund Flow"
    await goToScenariosList(page);
    await page.getByRole("row", { name: /refund flow/i }).click();

    // Then the form is populated with the existing data
    const nameField = page.getByLabel(/name/i);
    await expect(nameField).toHaveValue(/refund flow/i);

    const situationField = page.getByLabel(/situation/i);
    await expect(situationField).not.toBeEmpty();
  });

  // FIXME: V1 Scenario Editor UI not implemented - update flow doesn't exist yet
  // Also needs API seeding for test data
  test.fixme("update scenario name", async ({ page }) => {
    // Given I am editing scenario "Refund Flow" (seeded via API)
    // TODO: Seed scenario via API before test
    await goToScenariosList(page);
    await page.getByRole("row", { name: /refund flow/i }).click();

    // When I change the name to "Refund Flow (Updated)"
    const nameField = page.getByLabel(/name/i);
    await nameField.clear();
    await nameField.fill("Refund Flow (Updated)");

    // And I click "Save"
    await page.getByRole("button", { name: /save/i }).click();

    // Then I see the updated name in the list
    await expect(page).toHaveURL(/simulations(?!\/)/);
    const updatedRow = page.getByRole("row", {
      name: /refund flow \(updated\)/i,
    });
    await expect(updatedRow).toBeVisible();
  });

  // ===========================================================================
  // Criteria Management
  // ===========================================================================

  // FIXME: V1 Scenario Editor UI not implemented - criteria list doesn't exist yet
  test.fixme("add criterion to list", async ({ page }) => {
    // Given I am on the scenario editor
    await goToScenariosList(page);
    await page.getByRole("button", { name: /new scenario/i }).click();

    // When I type criterion "Agent must apologize"
    await page.getByLabel(/criterion/i).fill("Agent must apologize");

    // And I click the add button
    await page.getByRole("button", { name: /add criterion/i }).click();

    // Then the criterion appears in the criteria list
    const criteriaList = page.locator('[data-testid="criteria-list"]');
    await expect(criteriaList).toContainText("Agent must apologize");

    // And I can add more criteria (input is cleared)
    const criterionInput = page.getByLabel(/criterion/i);
    await expect(criterionInput).toHaveValue("");
  });

  // FIXME: V1 Scenario Editor UI not implemented - criteria removal doesn't exist yet
  test.fixme("remove criterion from list", async ({ page }) => {
    // Given criteria ["Criterion A", "Criterion B"] exist in the form
    await goToScenariosList(page);
    await page.getByRole("button", { name: /new scenario/i }).click();

    // Add two criteria
    await page.getByLabel(/criterion/i).fill("Criterion A");
    await page.getByRole("button", { name: /add criterion/i }).click();
    await page.getByLabel(/criterion/i).fill("Criterion B");
    await page.getByRole("button", { name: /add criterion/i }).click();

    // When I click remove on "Criterion A"
    const criterionA = page.locator('[data-testid="criterion-item"]', {
      hasText: "Criterion A",
    });
    await criterionA.getByRole("button", { name: /remove|delete|×/i }).click();

    // Then only "Criterion B" remains in the list
    const criteriaList = page.locator('[data-testid="criteria-list"]');
    await expect(criteriaList).not.toContainText("Criterion A");
    await expect(criteriaList).toContainText("Criterion B");
  });

  // ===========================================================================
  // Target Configuration
  // ===========================================================================

  // FIXME: V1 Scenario Editor UI not implemented - target selector doesn't exist yet
  // Also needs API seeding for prompts
  test.fixme("configure prompt as target", async ({ page }) => {
    // Given I am on the scenario editor
    await goToScenariosList(page);
    await page.getByRole("button", { name: /new scenario/i }).click();

    // And prompts exist in the project (seeded via API)
    // TODO: Seed prompts via API before test

    // When I open the target selector
    const targetSelector = page.getByRole("button", { name: /select target/i });
    await targetSelector.click();

    // Then I can select an existing prompt config
    const promptOption = page.getByRole("option", { name: /prompt/i });
    await expect(promptOption.first()).toBeVisible();
  });

  // FIXME: V1 Scenario Editor UI not implemented - HTTP agent target doesn't exist yet
  test.fixme("configure HTTP agent as target", async ({ page }) => {
    // Given I am on the scenario editor
    await goToScenariosList(page);
    await page.getByRole("button", { name: /new scenario/i }).click();

    // When I open the target selector
    const targetSelector = page.getByRole("button", { name: /select target/i });
    await targetSelector.click();

    // And I select "HTTP Agent"
    await page.getByRole("option", { name: /http agent/i }).click();

    // Then I can configure the HTTP endpoint details
    const urlField = page.getByLabel(/url|endpoint/i);
    await expect(urlField).toBeVisible();

    const methodField = page.getByLabel(/method/i);
    await expect(methodField).toBeVisible();
  });
});
