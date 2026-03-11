#!/usr/bin/env node
/**
 * Browser Test Verification Script
 *
 * Proves that an AI agent can spin up an isolated LangWatch instance
 * and drive a headless browser against it. Takes screenshots at each step.
 *
 * Usage: node scripts/verify-browser-test.js [APP_PORT]
 *
 * If APP_PORT is not given, reads from .dev-port file.
 */
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

const SCREENSHOT_DIR = path.join(__dirname, "..", "browser-tests", "verify");
const DEV_PORT_FILE = path.join(__dirname, "..", ".dev-port");

// Find Chromium binary (Playwright cache or system)
function findChromium() {
  const cacheDir = path.join(require("os").homedir(), ".cache", "ms-playwright");
  if (fs.existsSync(cacheDir)) {
    const dirs = fs.readdirSync(cacheDir).filter((d) => d.startsWith("chromium-")).sort();
    for (const dir of dirs.reverse()) {
      const bin = path.join(cacheDir, dir, "chrome-linux", "chrome");
      if (fs.existsSync(bin)) return bin;
    }
  }
  // Fallback to system
  for (const bin of ["/usr/bin/chromium-browser", "/usr/bin/chromium"]) {
    if (fs.existsSync(bin)) return bin;
  }
  throw new Error("No Chromium found. Run: npx playwright install chromium");
}

// Read port from .dev-port or CLI arg
function getAppPort() {
  const arg = process.argv[2];
  if (arg) return parseInt(arg, 10);
  if (fs.existsSync(DEV_PORT_FILE)) {
    const content = fs.readFileSync(DEV_PORT_FILE, "utf8");
    const match = content.match(/APP_PORT=(\d+)/);
    if (match) return parseInt(match[1], 10);
  }
  return 5560;
}

async function main() {
  const port = getAppPort();
  const baseUrl = `http://localhost:${port}`;
  const chromiumPath = findChromium();

  console.log(`\n=== Browser Test Verification ===`);
  console.log(`App URL:     ${baseUrl}`);
  console.log(`Chromium:    ${path.basename(path.dirname(chromiumPath))}/${path.basename(chromiumPath)}`);
  console.log(`Screenshots: ${path.relative(path.join(__dirname, ".."), SCREENSHOT_DIR)}\n`);

  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const browser = await chromium.launch({
    executablePath: chromiumPath,
    headless: true,
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  try {
    // Step 1: Load sign-in page
    console.log("Step 1: Loading sign-in page...");
    await page.goto(`${baseUrl}/auth/signin`, { waitUntil: "networkidle", timeout: 60000 });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "01-sign-in-page.png"), fullPage: true });
    console.log("  -> Screenshot: 01-sign-in-page.png");

    // Step 2: Register test user via tRPC API
    console.log("Step 2: Registering test user...");
    const regResp = await page.request.post(`${baseUrl}/api/trpc/user.register?batch=1`, {
      data: { "0": { json: { name: "Browser Test Agent", email: "browser-test@langwatch.ai", password: "BrowserTest123!" } } },
    });
    const regBody = await regResp.text();
    console.log(`  -> Registration: ${regResp.status()} ${regBody.includes("already exists") ? "(user already exists)" : "(created)"}`);

    // Step 3: Sign in through the UI
    console.log("Step 3: Signing in...");
    await page.goto(`${baseUrl}/auth/signin?callbackUrl=%2F`, { waitUntil: "networkidle", timeout: 30000 });
    await page.fill('input[name="email"]', "browser-test@langwatch.ai");
    await page.fill('input[name="password"]', "BrowserTest123!");
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "02-credentials-filled.png"), fullPage: true });
    console.log("  -> Screenshot: 02-credentials-filled.png");

    await page.click('button:has-text("Sign in")');
    // Wait for redirect away from sign-in
    await page.waitForURL((url) => !url.pathname.includes("/auth/signin"), { timeout: 30000 }).catch(() => {});
    // Give the app time to render
    await page.waitForTimeout(5000);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "03-post-sign-in.png"), fullPage: true });
    console.log("  -> Screenshot: 03-post-sign-in.png");
    console.log(`  -> Current URL: ${page.url()}`);

    // Step 4: Handle onboarding if present
    const isOnboarding = await page.getByText("Welcome Aboard", { exact: false }).isVisible().catch(() => false);
    if (isOnboarding) {
      console.log("Step 4: Completing onboarding...");
      await page.getByPlaceholder("Company Name").fill("Browser Test Org");
      await page.getByText("I agree to the LangWatch").click();
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, "04-onboarding-filled.png"), fullPage: true });
      console.log("  -> Screenshot: 04-onboarding-filled.png");

      const nextBtn = page.getByRole("button", { name: "Next" });
      const finishBtn = page.getByRole("button", { name: "Finish" });
      if (await nextBtn.isVisible().catch(() => false)) {
        await nextBtn.click();
        await page.waitForTimeout(2000);
        // Try to finish or skip remaining steps
        for (let i = 0; i < 5; i++) {
          if (await page.getByRole("button", { name: "Finish" }).isVisible().catch(() => false)) {
            if (!(await page.getByRole("button", { name: "Finish" }).isDisabled())) {
              await page.getByRole("button", { name: "Finish" }).click();
              break;
            }
          }
          if (await page.getByRole("button", { name: "Skip" }).isVisible().catch(() => false)) {
            await page.getByRole("button", { name: "Skip" }).click();
            await page.waitForTimeout(2000);
            continue;
          }
          if (await page.getByRole("button", { name: "Next" }).isVisible().catch(() => false)) {
            await page.getByRole("button", { name: "Next" }).click();
            await page.waitForTimeout(2000);
            continue;
          }
          break;
        }
      } else if (await finishBtn.isVisible().catch(() => false)) {
        await finishBtn.click();
      }
      await page.waitForTimeout(3000);
    } else {
      console.log("Step 4: No onboarding (user already set up)");
    }

    // Step 5: Navigate to the app root and wait for it to fully load
    console.log("Step 5: Capturing authenticated app state...");
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle", timeout: 60000 });
    // Wait for real content to render (sidebar, nav, or any text beyond loading)
    await page.waitForFunction(() => document.body.innerText.trim().length > 50, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "05-authenticated-app.png"), fullPage: true });
    console.log(`  -> Screenshot: 05-authenticated-app.png`);
    console.log(`  -> Final URL: ${page.url()}`);

    // Summary
    const screenshots = fs.readdirSync(SCREENSHOT_DIR).filter((f) => f.endsWith(".png"));
    console.log(`\n=== Verification Complete ===`);
    console.log(`Screenshots captured: ${screenshots.length}`);
    screenshots.forEach((f) => console.log(`  ${f}`));
    console.log(`\nAll screenshots saved to: ${path.relative(path.join(__dirname, ".."), SCREENSHOT_DIR)}`);
  } catch (error) {
    console.error(`\nERROR: ${error.message}`);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "error-state.png"), fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
