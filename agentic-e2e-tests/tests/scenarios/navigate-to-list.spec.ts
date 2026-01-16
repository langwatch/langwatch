import { test, expect } from "@playwright/test";

/**
 * Scenario Library - Navigate to scenarios list
 *
 * From: specs/scenarios/scenario-library.feature
 *
 * @e2e
 * Scenario: Navigate to scenarios list
 *   When I navigate to "/my-project/simulations"
 *   Then I see the scenarios list page
 *   And I see a "New Scenario" button
 */

test.describe("Scenario Library", () => {
  test("should navigate to scenarios list and see New Scenario button", async ({
    page,
  }) => {
    // Navigate to simulations page for the default project
    // Note: The actual project slug will depend on the test setup
    await page.goto("/");

    // Wait for initial page load
    await page.waitForLoadState("networkidle");

    // Find and click on the Simulations/Scenarios navigation item
    const simulationsLink = page.getByRole("link", { name: /simulations|scenarios/i });
    await simulationsLink.click();

    // Verify we're on the scenarios list page
    await expect(page).toHaveURL(/simulations/);

    // Verify the New Scenario button is visible
    const newScenarioButton = page.getByRole("button", { name: /new scenario/i });
    await expect(newScenarioButton).toBeVisible();
  });
});
