import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";

/**
 * This script launches a Chromium browser, navigates to your app,
 * lets you log in manually, and then saves the storage state (cookies, localStorage, etc.)
 * to 'auth.json' in the same directory.
 *
 * Usage:
 *   npx ts-node e2e/save-auth-state.ts
 * or
 *   npx playwright test e2e/save-auth-state.ts --project=chromium
 *
 * After logging in, return to the terminal and press Enter to save the state.
 */

void (async () => {
  // Launch browser in headed mode so you can interact with it
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Go to your app's login page
  await page.goto("http://localhost:5560/");

  // Instruct the user
  console.log("Please log in manually in the opened browser window.");
  console.log(
    "Once you are fully logged in, return here and press Enter to save the storage state."
  );

  // Wait for user input
  process.stdin.resume();
  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => resolve());
  });

  // Save storage state
  const storageStatePath = path.join(__dirname, "auth.json");
  await context.storageState({ path: storageStatePath });
  console.log(`✅ Storage state saved to ${storageStatePath}`);

  await browser.close();
  process.exit(0);
})();
