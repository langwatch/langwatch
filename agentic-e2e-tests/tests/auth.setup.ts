import { test as setup, expect } from "@playwright/test";
import path from "path";

const AUTH_FILE = path.join(__dirname, "..", ".auth", "user.json");

/**
 * Auth Setup for E2E Tests
 *
 * Creates a test user and authenticates before all tests run.
 * Session state is saved to .auth/user.json and reused by all test projects.
 *
 * Test user credentials:
 * - Email: e2e-test@langwatch.ai
 * - Password: TestPassword123!
 */

const TEST_USER = {
  name: "E2E Test User",
  email: "e2e-test@langwatch.ai",
  password: "TestPassword123!",
};

setup("authenticate", async ({ page, request }) => {
  // Step 1: Try to register the test user (may already exist)
  try {
    const registerResponse = await request.post("/api/trpc/user.register", {
      data: {
        json: {
          name: TEST_USER.name,
          email: TEST_USER.email,
          password: TEST_USER.password,
        },
      },
    });

    // 200 = created, other statuses may mean user already exists
    if (registerResponse.ok()) {
      console.log("Test user created successfully");
    } else {
      const body = await registerResponse.text();
      if (body.includes("User already exists")) {
        console.log("Test user already exists, proceeding with sign in");
      } else {
        console.log("Registration response:", registerResponse.status(), body);
      }
    }
  } catch (error) {
    // User might already exist from previous runs
    console.log("Registration skipped (user may already exist):", error);
  }

  // Step 2: Sign in through the UI
  await page.goto("/auth/signin");

  // Wait for the sign in form to be ready
  await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();

  // Fill in credentials
  await page.getByLabel(/email/i).fill(TEST_USER.email);
  await page.getByLabel(/password/i).fill(TEST_USER.password);

  // Submit the form
  await page.getByRole("button", { name: /sign in/i }).click();

  // Wait for successful authentication - should redirect away from signin
  await expect(page).not.toHaveURL(/\/auth\/signin/);

  // Step 3: Wait for either onboarding OR main app to appear
  // The page may show a loading screen first, so we need to wait for actual content
  console.log("Waiting for post-login page to load...");

  const onboardingHeading = page.getByText("Welcome Aboard", { exact: false });
  const mainAppNav = page.getByRole("navigation");

  // Wait for either onboarding or main navigation to appear (with longer timeout)
  await Promise.race([
    onboardingHeading.waitFor({ state: "visible", timeout: 30000 }),
    mainAppNav.waitFor({ state: "visible", timeout: 30000 }),
  ]).catch(() => {
    // If neither appears, continue anyway and check below
  });

  // Small delay to let React fully render
  await page.waitForTimeout(1000);

  // Step 4: Complete onboarding if shown
  const isOnboarding = await onboardingHeading.isVisible().catch(() => false);

  if (isOnboarding) {
    console.log("Completing onboarding flow...");

    // Fill in organization/company name
    const companyInput = page.getByPlaceholder("Company Name");
    await companyInput.fill("E2E Test Organization");
    console.log("  - Filled company name");

    // Accept terms of service (click the label since Chakra checkbox control intercepts pointer events)
    const tosLabel = page.getByText("I agree to the LangWatch");
    await tosLabel.click();
    console.log("  - Accepted terms");

    // Check if we have a "Next" button (multi-screen) or "Finish" button (single screen)
    const nextButton = page.getByRole("button", { name: "Next" });
    const finishButton = page.getByRole("button", { name: "Finish" });

    if (await nextButton.isVisible().catch(() => false)) {
      // Multi-screen onboarding flow
      await nextButton.click();
      await page.waitForLoadState("networkidle");
      console.log("  - Clicked Next");

      // Handle subsequent screens
      for (let i = 0; i < 5; i++) {
        // Select "For myself" if visible (simplifies flow)
        const myselfOption = page.getByText(/for myself/i);
        if (await myselfOption.isVisible().catch(() => false)) {
          await myselfOption.click();
          console.log("  - Selected 'For myself'");
        }

        // Look for Skip or Finish buttons
        const skipBtn = page.getByRole("button", { name: "Skip" });
        const finishBtn = page.getByRole("button", { name: "Finish" });
        const nextBtn = page.getByRole("button", { name: "Next" });

        if (await finishBtn.isVisible().catch(() => false)) {
          if (!(await finishBtn.isDisabled())) {
            await finishBtn.click();
            console.log("  - Clicked Finish");
            break;
          }
        }

        if (await skipBtn.isVisible().catch(() => false)) {
          await skipBtn.click();
          await page.waitForLoadState("networkidle");
          console.log("  - Clicked Skip");
          continue;
        }

        if (await nextBtn.isVisible().catch(() => false)) {
          if (!(await nextBtn.isDisabled())) {
            await nextBtn.click();
            await page.waitForLoadState("networkidle");
            console.log("  - Clicked Next");
            continue;
          }
        }

        // Nothing clickable, break
        break;
      }
    } else if (await finishButton.isVisible().catch(() => false)) {
      // Single-screen onboarding (self-hosted or simplified flow)
      // Wait for Finish button to be enabled
      await expect(finishButton).toBeEnabled({ timeout: 5000 });
      await finishButton.click();
      console.log("  - Clicked Finish (single screen)");
    }

    // Wait for onboarding to complete
    await page.waitForLoadState("networkidle");
    console.log("Onboarding completed");
  } else {
    console.log("No onboarding detected, user already set up");
  }

  // Step 5: Handle any additional setup screens (project creation, etc.)
  await page.waitForLoadState("networkidle");

  const needsProject = await page
    .getByRole("heading", { name: /create.*project/i })
    .isVisible()
    .catch(() => false);

  if (needsProject) {
    console.log("Creating test project...");
    const projectNameInput = page.getByRole("textbox", { name: /name/i });
    if (await projectNameInput.isVisible()) {
      await projectNameInput.fill("E2E Test Project");
      await page.getByRole("button", { name: /create/i }).click();
      await page.waitForLoadState("networkidle");
    }
    console.log("Project created");
  }

  // Step 6: Verify we're in the main app before saving
  // Wait a bit for any final redirects
  await page.waitForTimeout(2000);
  await page.waitForLoadState("networkidle");

  // Make sure we're not on onboarding anymore
  const stillOnboarding = await page
    .getByText("Welcome Aboard", { exact: false })
    .isVisible()
    .catch(() => false);

  if (stillOnboarding) {
    console.log("WARNING: Still on onboarding page, taking screenshot for debug");
    await page.screenshot({
      path: path.join(__dirname, "..", "debug-onboarding.png"),
    });
  }

  // Step 7: Save authentication state
  await page.context().storageState({ path: AUTH_FILE });

  console.log("Authentication state saved to:", AUTH_FILE);
});
