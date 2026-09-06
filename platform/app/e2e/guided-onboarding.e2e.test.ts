/**
 * The guided onboarding in a real browser: a fresh sign-up goes through the
 * organization and tailor steps, Langy takes over the screen (hello, value,
 * provider), the product opens with the panel docked and the tour runs over
 * the real navigation until it hands off to the panel. The skip path lands on
 * the personal home with the offer, and with the flag off the classic wizard
 * is what it always was.
 *
 * Every test signs up its own user, so nothing depends on a stored session.
 * The OpenAI key comes from the environment or platform/app/.env and never
 * reaches a log or an assertion message.
 *
 * @see specs/features/onboarding/guided-welcome-takeover.feature
 * @see specs/features/onboarding/guided-tour.feature
 */

import { expect, type Page, test } from "@playwright/test";
import { readFileSync } from "fs";
import path from "path";

const FLAG = "experiment_onboarding_langy_guided";
const PASSWORD = "GuidedE2e!2026";
const VIDEO_DIR = path.resolve(
  __dirname,
  "../../../.claude/tmp/guided-onboarding/video",
);

function openaiKey(): string {
  const fromEnvironment = process.env.OPENAI_API_KEY;
  if (fromEnvironment) return fromEnvironment;
  const dotenv = readFileSync(path.resolve(__dirname, "../.env"), "utf8");
  const key = /^OPENAI_API_KEY=(.*)$/m.exec(dotenv)?.[1]?.trim() ?? "";
  return key.replace(/^"|"$/g, "");
}

function freshAccount(label: string): { name: string; email: string } {
  const stamp = Date.now().toString(36);
  return {
    name: `Guided ${label}`,
    email: `guided-e2e-${label}-${stamp}@langwatch.local`,
  };
}

/** Sign up a brand new account and wait for the welcome flow to open. */
async function signUp({
  page,
  label,
  flag,
}: {
  page: Page;
  label: string;
  flag: "on" | "off";
}): Promise<{ name: string; email: string }> {
  const account = freshAccount(label);
  await page.goto(`/auth/signup?ff_${FLAG}=${flag}`);
  await page.locator('input[name="name"]').fill(account.name);
  await page.locator('input[name="email"]').fill(account.email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.locator('input[name="confirmPassword"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.waitForURL(/\/onboarding\/welcome/, { timeout: 90_000 });
  return account;
}

/** The organization step, then the tailor step answered as a company. */
async function organizationAndTailor({
  page,
  organizationName,
}: {
  page: Page;
  organizationName: string;
}): Promise<void> {
  await organizationStep({ page, organizationName });
  await tailorStep(page);
}

/** The first screen: the organization name and the terms. */
async function organizationStep({
  page,
  organizationName,
}: {
  page: Page;
  organizationName: string;
}): Promise<void> {
  // The welcome flow settles after the sign-in redirect: a value typed into
  // the first render is lost when the screen re-renders with the session.
  await page.waitForLoadState("networkidle");
  const organizationInput = page.getByLabel("Organization name");
  await expect(organizationInput).toBeVisible();
  await organizationInput.fill(organizationName);
  await expect(organizationInput).toHaveValue(organizationName);
  // The checkbox input is visually hidden; its control is what a person
  // clicks.
  await page
    .locator('[data-scope="checkbox"][data-part="control"]')
    .first()
    .click();
  await expect(page.getByRole("checkbox")).toBeChecked();
  const next = page.getByRole("button", { name: "Next" });
  await expect(next).toBeEnabled();
  await next.click();
}

/** The tailor step, answered as a company of 11-50 deploying to the cloud. */
async function tailorStep(page: Page): Promise<void> {
  const company = page.getByRole("radio", { name: "Company" });
  await expect(company).toBeVisible();
  for (const name of ["Company", "Clients", "Myself"]) {
    await expect(page.getByRole("radio", { name })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  }
  await company.click();
  await expect(page.getByText("How large is your company?")).toBeVisible();
  await page.getByRole("radio", { name: "11-50" }).click();
  await page.getByRole("radio", { name: "Cloud" }).click();
  await page.getByRole("button", { name: "Next" }).click();
}

/** Langy's greeting types itself out; Next fades in when it lands. */
async function helloThenNext(page: Page): Promise<void> {
  const hello = page.getByTestId("hello-line");
  await expect(hello).toBeVisible({ timeout: 60_000 });
  await expect(hello).toContainText("I'm Langy");
  await expect(hello).toContainText("I'll be your guide today.");
  await page.getByTestId("takeover-next").click();
}

/** The value question: pick the paths in this order, then Next. */
async function pickPaths({
  page,
  picks,
}: {
  page: Page;
  picks: Array<{ id: string; title: string }>;
}): Promise<void> {
  await expect(page.getByTestId("value-line")).toContainText(
    "what are the most valuable things we can set up for",
  );
  await expect(page.getByTestId("value-cards")).toBeVisible();
  for (const [index, pick] of picks.entries()) {
    await page.getByRole("button", { name: pick.title }).click();
    await expect(page.getByTestId(`pick-order-${pick.id}`)).toHaveText(
      String(index + 1),
    );
  }
  await page.getByTestId("takeover-next").click();
}

async function readGuidedState({
  page,
  organizationName,
}: {
  page: Page;
  organizationName: string;
}): Promise<{
  donePaths: string[];
  currentPath?: string;
  tourCompletedAt?: string;
  providerSkippedAt?: string;
  tourSkippedAt?: string;
}> {
  const organizations = await trpcQuery<Array<{ id: string; name: string }>>({
    page,
    procedure: "organization.getAll",
    input: {},
  });
  const organization = organizations.find((o) => o.name === organizationName);
  if (!organization)
    throw new Error(`no organization named ${organizationName}`);
  return await trpcQuery({
    page,
    procedure: "onboarding.getGuidedState",
    input: { organizationId: organization.id },
  });
}

async function trpcQuery<T>({
  page,
  procedure,
  input,
}: {
  page: Page;
  procedure: string;
  input: unknown;
}): Promise<T> {
  const encoded = encodeURIComponent(JSON.stringify({ json: input }));
  const response = await page.request.get(
    `/api/trpc/${procedure}?input=${encoded}`,
  );
  const body = (await response.json()) as { result: { data: { json: T } } };
  return body.result.data.json;
}

test.describe("guided onboarding", () => {
  // The browser's own errors and warnings, in the run's output: a tour that
  // never starts or a panel that stays shut leaves its reason here and
  // nowhere the screenshot can show.
  test.beforeEach(({ page }) => {
    page.on("pageerror", (error) => {
      console.log(`[browser] pageerror: ${error.message}`);
    });
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        console.log(`[browser] ${message.type()}: ${message.text()}`);
      }
    });
  });

  test.afterEach(async ({ page }, testInfo) => {
    const video = page.video();
    await page.close();
    if (video) {
      const slug = testInfo.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      await video.saveAs(path.join(VIDEO_DIR, `${slug}.webm`));
    }
  });

  /** @scenario A fresh sign-up goes through the guided screens and lands with the panel open */
  /** @scenario the llmops tour runs through its four steps on Next and hands off to the panel */
  test("a fresh sign-up is taken over by Langy, connects a provider, lands with the panel open and is toured", async ({
    page,
  }) => {
    const key = openaiKey();
    expect(key.length).toBeGreaterThan(10);
    const account = await signUp({ page, label: "guided", flag: "on" });
    const organizationName = `ACME ${account.name}`;
    await organizationAndTailor({ page, organizationName });

    await helloThenNext(page);
    await pickPaths({
      page,
      picks: [
        { id: "llmops", title: "Evals & LLM Ops" },
        { id: "gateway", title: "Gateway" },
      ],
    });

    // Provider: "those up", OpenAI, a real key, Connect.
    await expect(page.getByTestId("provider-line")).toContainText(
      "I'll help you set those up.",
    );
    await page.getByLabel("OpenAI", { exact: true }).click();
    await page.getByLabel("API key").fill(key);
    const connect = page.getByRole("button", { name: "Connect" });
    await connect.click();
    await expect(
      page.getByRole("button", { name: /Connected|Checking the key/ }),
    ).toBeVisible();

    // Landing: the first pick's page with the panel docked.
    await page.waitForURL(/\/traces/, { timeout: 90_000 });
    const panel = page.locator('[data-tour="langy-panel"]');
    await expect(panel).toBeVisible({ timeout: 60_000 });

    // The tour: four steps over the real navigation, Next on each.
    const caption = page.getByTestId("tour-caption");
    try {
      await expect(caption).toBeVisible({ timeout: 60_000 });
    } catch (error) {
      // A tour that never starts is a host race: what the organization holds
      // and what the browser persisted for the panel say which side stalled.
      const state = await readGuidedState({ page, organizationName }).catch(
        (reason) => ({ unreadable: String(reason) }),
      );
      const persisted = await page.evaluate(() =>
        Object.fromEntries(
          Object.keys(localStorage)
            .filter((key) => /langy|guided|tour/i.test(key))
            .map((key) => [key, localStorage.getItem(key)]),
        ),
      );
      console.log("[diagnostic] guided state:", JSON.stringify(state));
      console.log("[diagnostic] browser storage:", JSON.stringify(persisted));
      console.log("[diagnostic] url:", page.url());
      throw error;
    }
    await expect(caption).toContainText("This is the menu");
    await expect(caption).toContainText("1 of 4");
    for (let step = 1; step <= 4; step += 1) {
      await expect(caption).toContainText(`${step} of 4`);
      await caption.getByRole("button", { name: "Next" }).click();
    }

    // The handoff: the spotlight sits on the panel, the card is in it.
    await expect(
      page.locator('[data-testid="tour-spotlight"][data-handoff]'),
    ).toBeVisible({ timeout: 15_000 });
    const card = page.getByTestId("guided-tour-card");
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card).toContainText(/Guided tour/);
    await expect(caption).toBeHidden();

    await expect
      .poll(
        async () =>
          (await readGuidedState({ page, organizationName })).tourCompletedAt,
        { timeout: 30_000 },
      )
      .toBeTruthy();
  });

  /** @scenario Skipping the guided tour on the provider screen lands on the personal home with the panel asking for a model */
  test("skipping the guided tour on the provider screen lands on the personal home with the panel asking for a model", async ({
    page,
  }) => {
    const account = await signUp({ page, label: "skip", flag: "on" });
    const organizationName = `ACME ${account.name}`;
    await organizationAndTailor({ page, organizationName });
    await helloThenNext(page);
    await pickPaths({
      page,
      picks: [{ id: "coding", title: "Coding Agent Tracking" }],
    });
    await expect(page.getByTestId("provider-line")).toContainText(
      "I'll help you set that up.",
    );

    await page.getByText("Skip Guided Tour").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Are you sure sure?");
    await expect(dialog).toContainText(
      "It's much easier to get Langy to setup everything for you.",
    );
    await expect(
      dialog.getByRole("button", { name: "Keep the guide" }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Skip anyway" }).click();

    // The personal home, with the panel open and asking for the model the
    // provider step would have connected; the coding path is the one being
    // guided, so its space shows no offer.
    await page.waitForURL(/\/me(\/|\?|$)/, { timeout: 90_000 });
    const panel = page.locator('[data-tour="langy-panel"]');
    await expect(panel).toBeVisible({ timeout: 60_000 });
    await expect(panel).toContainText("Langy needs a model to get started", {
      timeout: 60_000,
    });
    await expect(page.getByTestId("guided-onboarding-offer")).toHaveCount(0);
    // The kickoff owed at landing survives the panel's scope reset: the tour
    // card is in the thread behind the model gate, waiting for a model.
    await expect(page.getByTestId("guided-tour-card")).toBeVisible({
      timeout: 30_000,
    });
    const state = await readGuidedState({ page, organizationName });
    expect(state.providerSkippedAt).toBeTruthy();
    // Skip anyway skips the guide as a whole: the tour is recorded as skipped
    // too, which is what makes Langy open with the no-worries line.
    expect(state.tourSkippedAt).toBeTruthy();
    expect(state.tourCompletedAt).toBeFalsy();
    expect(state.currentPath).toBe("coding");
  });

  /** @scenario With the flag off the classic wizard is unchanged */
  test("with the flag off the classic wizard follows the tailor step", async ({
    page,
  }) => {
    const account = await signUp({ page, label: "classic", flag: "off" });
    await organizationStep({
      page,
      organizationName: `ACME ${account.name}`,
    });
    // The classic wizard asks what you want to do right after the
    // organization; the guided variant never shows that screen.
    await expect(
      page.getByRole("radiogroup", { name: "What do you want to do?" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("hello-line")).toHaveCount(0);
    await expect(page.getByTestId("takeover-stage")).toHaveCount(0);
  });
});
