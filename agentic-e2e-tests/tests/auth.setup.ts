import { test as setup, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

const AUTH_DIR = path.join(__dirname, "..", ".auth");
const AUTH_FILE = path.join(AUTH_DIR, "user.json");

// Ensure .auth directory exists
if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

/**
 * Auth Setup for E2E Tests
 *
 * Creates a test user and authenticates before all tests run.
 * Session state is saved to .auth/user.json and reused by all test projects.
 *
 * Test user credentials (shared with /browser-test and verify-browser-test.js):
 * - Email: browser-test@langwatch.ai
 * - Password: BrowserTest123!
 */

const TEST_USER = {
  name: "Browser Test Agent",
  email: "browser-test@langwatch.ai",
  password: "BrowserTest123!",
};

setup("authenticate", async ({ page, request }) => {
  // Step 1: Try to register the test user (may already exist)
  try {
    const registerResponse = await request.post("/api/trpc/user.register?batch=1", {
      data: {
        "0": {
          json: {
            name: TEST_USER.name,
            email: TEST_USER.email,
            password: TEST_USER.password,
          },
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

  // Step 2: Sign in through the UI (callbackUrl ensures redirect to app root after sign-in)
  await page.goto("/auth/signin?callbackUrl=%2F");

  // Wait for the sign in form to be ready
  await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();

  // Fill in credentials - use label-based locators with fallback
  await page.getByLabel(/email/i).fill(TEST_USER.email);
  await page.getByLabel(/password/i).fill(TEST_USER.password);

  // Submit the form
  await page.getByRole("button", { name: /sign in/i }).click();

  // Wait for successful authentication - should redirect away from signin
  await expect(page).not.toHaveURL(/\/auth\/signin/);
  console.log("Signed in successfully. Current URL:", page.url());

  // Step 3: Create org + project via API if not already set up.
  // page.request inherits the browser session cookies from the sign-in above,
  // so this call is fully authenticated. This is more reliable than clicking
  // through the onboarding UI (which has timing/button-label issues in self-hosted mode).
  console.log("Checking if org/project setup is needed...");

  const getAllResponse = await page.request.get(
    "/api/trpc/organization.getAll?batch=1&input=" +
      encodeURIComponent(JSON.stringify({ "0": { json: {} } })),
  );
  console.log("getAll status:", getAllResponse.status());
  const getAllData = await getAllResponse.json().catch(() => null);
  const orgs: Array<{ teams: Array<{ projects: Array<unknown> }> }> =
    getAllData?.["0"]?.result?.data?.json ?? [];
  console.log(
    "Orgs found:",
    orgs.length,
    "| Projects:",
    orgs.flatMap((o) => o.teams).flatMap((t) => t.projects).length,
  );
  const hasProject = orgs.some((o) =>
    o.teams.some((t) => t.projects.length > 0),
  );

  if (!hasProject) {
    console.log("No project found — creating org + project via API...");
    const initResponse = await page.request.post(
      "/api/trpc/onboarding.initializeOrganization?batch=1",
      {
        data: {
          "0": {
            json: {
              orgName: "Browser Test Org",
              projectName: "Browser Test Project",
              language: "other",
              framework: "other",
            },
          },
        },
      },
    );
    console.log("initializeOrganization status:", initResponse.status());
    const initData = await initResponse.json().catch(() => null);
    if (!initResponse.ok() || initData?.["0"]?.error) {
      throw new Error(
        `initializeOrganization failed: ${JSON.stringify(initData).slice(0, 500)}`,
      );
    }
    console.log("Org + project created successfully.");
  } else {
    console.log("Org/project already exists, skipping setup.");
  }

  // Step 4: Navigate to the app root and wait for main navigation.
  // This confirms the session + org/project are wired up before saving state.
  console.log("Navigating to app root to confirm setup...");
  await page.goto("/");

  const homeLink = page.getByRole("link", { name: "Home", exact: true });
  try {
    await homeLink.waitFor({ state: "visible", timeout: 30000 });
  } catch (err) {
    console.log("Home link not visible. URL:", page.url());
    await page.screenshot({
      path: path.join(__dirname, "..", "debug-post-setup.png"),
    });
    throw err;
  }

  // Step 5: Save authentication state
  await page.context().storageState({ path: AUTH_FILE });

  console.log("Authentication state saved to:", AUTH_FILE);
});
