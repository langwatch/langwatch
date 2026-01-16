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
  // The app typically redirects to the projects page or onboarding
  await expect(page).not.toHaveURL(/\/auth\/signin/);

  // Verify we're authenticated by checking for user-specific UI elements
  // This could be the user menu, dashboard, or onboarding flow
  await page.waitForLoadState("networkidle");

  // Step 3: Save authentication state
  await page.context().storageState({ path: AUTH_FILE });

  console.log("Authentication state saved to:", AUTH_FILE);
});
