/**
 * The browser product journey.
 * Spec: specs/e2e/browser-product-journey.feature
 */
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";

import { ECHO_AGENT_REPLY } from "./echo-agent";
import { NO_MODEL_PROVIDER_KEY as NO_KEY } from "./journey.constants";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5570";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const RUN = Date.now().toString(36);
const ACCOUNT = {
  name: "Journey Walker",
  email: `journey-${RUN}@example.test`,
  password: "JourneyWalk!2026",
};
const ORG_NAME = `Journey Org ${RUN}`;
const AGENT_NAME = `Journey Echo Agent ${RUN}`;
const DEAD_AGENT_NAME = `Journey Dead Agent ${RUN}`;
const EVALUATOR_NAME = `Journey Code Evaluator ${RUN}`;
const MONITOR_NAME = `Journey Monitor ${RUN}`;
const SUITE_NAME = `Journey Suite ${RUN}`;
const SCENARIO_TITLE = `Journey Scenario ${RUN}`;
const WORKFLOW_NAME = `Journey Workflow ${RUN}`;
const PROMPT_HANDLE = `journey-prompt-${RUN}`;

// One input, so the monitor that runs it has one field to map and the run's
// own output is the whole of it.
const EVALUATOR_CODE = [
  "class Code:",
  "    def __call__(self, output: str):",
  '        return {"passed": True, "score": 1.0, "details": "journey evaluator ran"}',
].join("\n");

let context: BrowserContext;
let page: Page;
let projectSlug = "";
let echoAgentUrl = "";
let accountExists = false;

test.describe.configure({ mode: "serial" });

test.describe("browser product journey", () => {
  test.beforeAll(async ({ browser }) => {
    echoAgentUrl = process.env.E2E_ECHO_AGENT_URL ?? "";
    expect(echoAgentUrl, "global setup starts the echo agent").not.toBe("");
    context = await browser.newContext({
      baseURL: BASE_URL,
      storageState: { cookies: [], origins: [] },
      // A haven stack serves https under a local certificate authority.
      ignoreHTTPSErrors: true,
    });
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await context?.close();
  });

  // @scenario "Sign-up refuses a password confirmation that does not match"
  test("refuses a sign-up whose password confirmation does not match", async () => {
    await openSignUp();

    await page.getByLabel("Name").fill(ACCOUNT.name);
    await page.getByLabel("Email").fill(`mismatch-${RUN}@example.test`);
    await page.getByLabel("Password", { exact: true }).fill(ACCOUNT.password);
    await page.getByLabel("Confirm Password").fill(`${ACCOUNT.password}-other`);
    await page.getByRole("button", { name: /^sign up$/i }).click();

    await expect(page.getByText(/passwords don't match/i)).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/signup/);
  });

  // @scenario "Signing up creates the account and signs me in"
  test("signs up a fresh account through the real form", async () => {
    await openSignUp();
    await page.getByLabel("Name").fill(ACCOUNT.name);
    await page.getByLabel("Email").fill(ACCOUNT.email);
    await page.getByLabel("Password", { exact: true }).fill(ACCOUNT.password);
    await page.getByLabel("Confirm Password").fill(ACCOUNT.password);
    await page.getByRole("button", { name: /^sign up$/i }).click();

    // Registration is one slow call on a loaded machine, and the sign-in it
    // performs can land after the form has settled back; the account exists
    // either way, so the walk signs in rather than failing the leg on it.
    accountExists = true;
    await page
      .waitForURL((url) => !url.pathname.startsWith("/auth/"), { timeout: 60000 })
      .catch(() => undefined);
    await recoverSession();
    await expect(page).not.toHaveURL(/\/auth\//, { timeout: 60000 });
  });

  // @scenario "Onboarding names the organization and lands me on a project"
  test("names an organization, picks an intent, and lands on a project", async () => {
    await visit("/onboarding/welcome");

    const orgName = page.getByLabel("Organization name");
    await expect(orgName).toBeVisible({ timeout: 60000 });
    await orgName.fill(ORG_NAME);
    await expect(orgName).toHaveValue(ORG_NAME);

    // The terms label wraps two external links, so the control is what a person
    // actually hits; the hidden input behind role=checkbox is covered by it. A
    // click before the screen has settled lands on nothing, so it is confirmed.
    const terms = page.locator('[data-scope="checkbox"][data-part="control"]').first();
    await expect(terms).toBeVisible({ timeout: 30000 });
    for (let attempt = 0; attempt < 4; attempt++) {
      if ((await terms.getAttribute("data-state")) === "checked") break;
      await terms.click();
      await page.waitForTimeout(500);
    }
    await expect(terms).toHaveAttribute("data-state", "checked");

    // Onboarding decides its own screen list from the deployment's flags, so
    // the walk answers whatever it is asked rather than naming a fixed count.
    // A busy Next is the organization being created, not a refusal, so the walk
    // waits it out instead of reading it as one.
    const deadline = Date.now() + 240000;
    while (Date.now() < deadline && !inProject()) {
      await recoverSession();
      const skip = page.getByRole("link", { name: /continue to langwatch/i });
      if (await skip.isVisible().catch(() => false)) {
        await skip.click().catch(() => undefined);
        break;
      }

      const intent = page.getByRole("radio", { name: /monitor & evaluate my llm app/i });
      const chosen = (await intent.isVisible().catch(() => false))
        ? intent
        : page.getByRole("radio").first();
      if (await chosen.isVisible().catch(() => false)) {
        await chosen.click().catch(() => undefined);
      }

      const forward = page.getByRole("button", { name: /^(next|finish)$/i }).first();
      if (await forward.isEnabled().catch(() => false)) {
        await forward.click().catch(() => undefined);
      }
      await page.waitForTimeout(1500);
    }

    // The skip link is a hard redirect and the click on it can land while the
    // screen re-renders, so follow its address when the walk is still on an
    // onboarding page a second later.
    for (let wait = 0; wait < 30 && !inProject(); wait++) {
      await recoverSession();
      const href = await page
        .getByRole("link", { name: /continue to langwatch/i })
        .first()
        .getAttribute("href", { timeout: 2000 })
        .catch(() => null);
      if (href) {
        await page.goto(href);
        break;
      }
      await page.waitForTimeout(1000);
    }
    expect(inProject(), `onboarding left the walk at ${page.url()}`).toBe(true);

    projectSlug = new URL(page.url()).pathname.split("/")[1] ?? "";
    expect(projectSlug).not.toBe("");
  });

  // @scenario "Adding an OpenAI model provider makes models available"
  test("adds OpenAI as a model provider", async () => {
    test.skip(!OPENAI_API_KEY, NO_KEY);

    await openPage(
      "/settings/model-providers",
      page.getByRole("heading", { name: /model providers/i }),
    );

    // The provider list is a menu on the header button, and the editor it opens
    // is a drawer; a click that lands while the menu is still opening is lost,
    // so the key field is what the walk waits on.
    const addProvider = page.getByRole("button", { name: /add model provider/i }).first();
    const keyField = page.getByLabel("OPENAI_API_KEY");
    let pickFailure = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      if (await keyField.isVisible().catch(() => false)) break;
      try {
        await addProvider.click();
        // The open menu never settles (D8), so a stability-waiting click never
        // fires; a person's click lands anyway.
        await page
          .getByRole("menuitem", { name: "OpenAI", exact: true })
          .first()
          .click({ force: true });
      } catch (error) {
        pickFailure = error instanceof Error ? error.message : String(error);
      }
      await keyField.waitFor({ state: "visible", timeout: 30000 }).catch(() => undefined);
    }
    await expect(
      keyField,
      `picking OpenAI never opened the provider editor (defect D7 in ` +
        `dev/docs/plans/e2e-journey-2026-09-04.md: model-provider-host.tsx:104 ` +
        `passes an unbound setQuery, so the drawer address is never written)` +
        (pickFailure ? `; last click error: ${pickFailure}` : ""),
    ).toBeVisible({ timeout: 30000 });

    await keyField.fill(OPENAI_API_KEY ?? "");
    await page
      .getByRole("button", { name: /^save( anyway)?$/i })
      .last()
      .click();
    await expect(keyField).not.toBeVisible({ timeout: 60000 });

    await visit("/settings/model-providers");
    await expect(page.getByText("OpenAI", { exact: true }).first()).toBeVisible({ timeout: 30000 });
  });

  // @scenario "Creating an HTTP agent pointed at the echo agent"
  test("creates an HTTP agent pointed at the echo agent", async () => {
    await createHttpAgent(AGENT_NAME, echoAgentUrl);
    await openProjectPage("agents", "Agents");
    await expect(page.getByText(AGENT_NAME).first()).toBeVisible({ timeout: 30000 });
  });

  // @scenario "Creating a custom code evaluator"
  test("creates a Custom (Code) evaluator", async () => {
    await openProjectPage("evaluators", "Evaluators");
    await page
      .getByRole("button", { name: /new evaluator|create your first evaluator/i })
      .first()
      .click();

    await page.getByTestId("evaluator-category-code").click();

    const name = page.getByTestId("code-evaluator-name");
    await expect(name).toBeVisible({ timeout: 15000 });
    await name.fill(EVALUATOR_NAME);
    await fillCodeEditor(EVALUATOR_CODE);
    // The editor seeds two inputs; the second has nothing on a trace to map to.
    await page.getByLabel("Remove inputs expected_output").click();
    await expect(page.getByTestId("code-evaluator-input-identifier-0")).toHaveValue("output");
    await page.getByTestId("save-code-evaluator").click();

    await expect(name).not.toBeVisible({ timeout: 20000 });
    await openProjectPage("evaluators", "Evaluators");
    await expect(page.getByText(EVALUATOR_NAME).first()).toBeVisible({ timeout: 30000 });
  });

  // @scenario "Creating a monitor that runs the evaluator on every trace"
  test("creates an online evaluation that runs the evaluator on every trace", async () => {
    test.skip(!OPENAI_API_KEY, NO_KEY);

    await visit(`/${projectSlug}/online-evaluations?drawer.open=onlineEvaluation`);
    await expect(page.getByText(/^Trace Level$/)).toBeVisible({ timeout: 30000 });
    await page.getByText(/^Trace Level$/).click();

    await page.getByRole("button", { name: /select evaluator/i }).click();
    await page.getByText(EVALUATOR_NAME).first().click();

    // Picking one lands on a Configure step that maps its variables, and the
    // footer there confirms the choice under the same name as the trigger.
    await expect(page.getByRole("heading", { name: /configure evaluator/i })).toBeVisible({
      timeout: 20000,
    });
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Select Evaluator", exact: true })
      .click();

    const nameField = page.getByPlaceholder("Enter evaluation name");
    await expect(
      nameField,
      "confirming the evaluator never returned to the online evaluation (defect D10 in " +
        "dev/docs/plans/e2e-journey-2026-09-04.md: a code evaluator carries no evaluatorType, " +
        "so the shared editor's save returns without doing anything)",
    ).toBeVisible({ timeout: 20000 });
    await nameField.fill(MONITOR_NAME);

    await expect(page.getByText(/this evaluation will run on every/i).first()).toBeVisible();

    // A refusal here is silent: the button carries aria-disabled rather than the
    // attribute, so a click on it is accepted and drops.
    const create = page.getByRole("button", { name: /create online evaluation/i });
    const refusal = await create.evaluate((element) => ({
      disabled: (element as HTMLButtonElement).disabled,
      aria: element.getAttribute("aria-disabled"),
      dataDisabled: element.getAttribute("data-disabled"),
      drawer: element.closest("[role=dialog]")?.textContent?.slice(0, 600) ?? "",
    }));
    expect(
      refusal.disabled || refusal.aria === "true" || refusal.dataDisabled !== null,
      `the online evaluation cannot be created: ${JSON.stringify(refusal)}`,
    ).toBe(false);

    // The button re-renders as the mapping validates, and a click that lands on
    // the refusing render is accepted and dropped, so the closed drawer is what
    // says the evaluation was created.
    for (let attempt = 0; attempt < 5; attempt++) {
      if (!(await nameField.isVisible().catch(() => false))) break;
      await create.click({ force: true }).catch(() => undefined);
      await nameField.waitFor({ state: "hidden", timeout: 10000 }).catch(() => undefined);
    }
    await expect(
      nameField,
      `creating the online evaluation was refused without saying so: ${JSON.stringify(refusal)}`,
    ).not.toBeVisible({ timeout: 20000 });

    await openProjectPage("online-evaluations", "Online Evaluations");
    await expect(page.getByText(MONITOR_NAME).first()).toBeVisible({ timeout: 30000 });
  });

  // @scenario "Writing a scenario in a suite and starting the run"
  test("names a suite, writes a scenario, and starts the run against the echo agent", async () => {
    test.skip(!OPENAI_API_KEY, NO_KEY);

    await openAgentTesting();
    await ensureTestSuite();
    await writeScenario();
    await page.getByTestId("case-modal-save-and-run").last().click();
    await expect(page.getByTestId("run-case-dialog")).toBeVisible({ timeout: 30000 });

    await pickAgentAndRun(AGENT_NAME);
    await expect(page.getByTestId("agent-testing-run-drawer")).toBeVisible({ timeout: 60000 });
  });

  // @scenario "The run reaches a verdict and appears on the Results tab"
  test("reads the run verdict and finds the run plan on the Results tab", async () => {
    test.skip(!OPENAI_API_KEY, NO_KEY);

    // A lane restart while the run is judged leaves the tab on "Couldn't load
    // your workspace" and the drawer gone, so the walk reloads and reopens the
    // run from the Results tab, which is where a person would look for it.
    const verdict = page.getByTestId("run-verdict-panel").or(page.getByTestId("run-verdict-error"));
    const stalled = page.getByRole("heading", { name: /couldn't load your workspace/i });
    for (let attempt = 0; attempt < 6; attempt++) {
      const seen = await verdict
        .first()
        .waitFor({ state: "visible", timeout: 60000 })
        .then(() => true)
        .catch(() => false);
      if (seen) break;
      if (
        (await stalled.isVisible().catch(() => false)) ||
        !(await page
          .getByTestId("agent-testing-run-drawer")
          .isVisible()
          .catch(() => false))
      ) {
        await visit(`/${projectSlug}/agent-testing/results`);
        await page
          .getByTestId("agent-testing-run-plans")
          .getByText(SCENARIO_TITLE)
          .first()
          .click()
          .catch(() => undefined);
      }
    }
    await verdict.first().waitFor({ state: "visible", timeout: 60000 });
    await expect(page.getByTestId("agent-testing-run-drawer")).toContainText(ECHO_AGENT_REPLY, {
      timeout: 60000,
    });

    await visit(`/${projectSlug}/agent-testing/results`);
    await expect(page.getByTestId("agent-testing-results-tab")).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("agent-testing-run-plans")).toBeVisible({ timeout: 30000 });
  });

  // @scenario "The run's trace carries the evaluator's result"
  test("finds the run's trace with the evaluator's result on it", async () => {
    test.skip(!OPENAI_API_KEY, NO_KEY);

    await visit(`/${projectSlug}/traces`);
    // Virtual spacers are rows too, so only rows that carry text count.
    const rows = page.locator("tbody tr").filter({ hasText: /\S/ });
    const crashed = page.getByRole("heading", { name: /something went wrong/i });
    await expect
      .poll(
        async () => {
          await page.reload();
          if (await crashed.isVisible().catch(() => false)) {
            throw new Error(
              "the Trace Explorer crashed into its error boundary (defect D12 in " +
                "dev/docs/plans/e2e-journey-2026-09-04.md: getEffectiveLens returns a fresh " +
                "object on every read, so the table's store subscription never settles)",
            );
          }
          return rows.count().catch(() => 0);
        },
        { timeout: 240000, intervals: [10000] },
      )
      .toBeGreaterThan(0);

    await rows.first().click();
    const evals = page.locator('[data-section="evals"]');
    await expect(evals).toBeVisible({ timeout: 60000 });
    await expect(evals).toContainText(EVALUATOR_NAME, { timeout: 120000 });
  });

  // @scenario "A run against an address that does not answer ends in a named failure"
  test("ends a run against an address that does not answer in a named failure", async () => {
    test.skip(!OPENAI_API_KEY, NO_KEY);

    await createHttpAgent(DEAD_AGENT_NAME, "http://127.0.0.1:9/does-not-answer");
    await ensureSuiteAndScenario();
    await openRunDialogForScenario();
    await pickAgentAndRun(DEAD_AGENT_NAME);

    const drawer = page.getByTestId("agent-testing-run-drawer");
    await expect(drawer).toBeVisible({ timeout: 60000 });
    await page
      .getByTestId("run-verdict-error")
      .or(page.getByTestId("run-verdict-panel"))
      .first()
      .waitFor({ state: "visible", timeout: 420000 });
    await expect(drawer).toContainText(/fail|error|refus|could not|unable/i);
  });

  // @scenario "The run dialog refuses a run with no agent chosen"
  test("refuses a run with no agent chosen", async () => {
    // Last of the run legs, because it takes the project's agents away: with
    // one present the picker has no way to un-choose it, so the only project
    // that can show this refusal is one with nothing to run against.
    await ensureSuiteAndScenario();
    await deleteEveryAgent();

    await visit(`/${projectSlug}/agent-testing/results`);
    await expect(page.getByTestId("agent-testing-results-tab")).toBeVisible({ timeout: 90000 });
    await page.getByRole("button", { name: "New run plan" }).first().click();

    // A plan covers a suite rather than one scenario, so it is the other dialog.
    const dialog = page.getByTestId("run-dialog");
    await expect(dialog).toBeVisible({ timeout: 30000 });
    await dialog.getByTestId("run-dialog-name").fill(`Journey refusal ${RUN}`);
    await expect(dialog.getByTestId("run-dialog-setup-agent")).toBeVisible({ timeout: 20000 });

    const run = dialog.getByTestId("run-dialog-run");
    await expect(run).toBeDisabled();
    // The reason is printed in the footer beside the refused control, so it is
    // read the same way with a mouse, a keyboard or a screen reader.
    await expect(page.getByText("Choose an agent to run against.").first()).toBeVisible({
      timeout: 15000,
    });
  });

  // @scenario "Creating a workflow and a prompt from the product surfaces"
  test("creates a workflow from a template and a prompt with an identifier", async () => {
    await openProjectPage("workflows", "Workflows");
    await page
      .getByRole("button", { name: /new workflow|create your first workflow/i })
      .first()
      .click();
    await page.getByTestId("new-workflow-card-blank").click();
    await page.getByRole("textbox", { name: "Name and Icon" }).fill(WORKFLOW_NAME);
    await page.getByRole("button", { name: /^create workflow$/i }).click();
    // A new workflow opens in the studio, on its own id.
    await expect(page).toHaveURL(/\/studio\/workflow_.+/, { timeout: 60000 });

    await visit(`/${projectSlug}/prompts`);
    const newPrompt = page.getByRole("button", { name: /new prompt|create first prompt/i }).first();
    await newPrompt.waitFor({ state: "visible", timeout: 90000 });

    await newPrompt.click();
    await page.getByTestId("save-prompt-button").click();
    await page.getByLabel("Prompt Identifier").fill(PROMPT_HANDLE);
    await page
      .getByRole("button", { name: /^save$/i })
      .last()
      .click();
    await expect(page.getByText(/prompt saved/i).first()).toBeVisible({ timeout: 30000 });
  });
});

/**
 * Takes every agent off the project, through the row menu and the typed
 * confirmation a person goes through.
 */
async function deleteEveryAgent(): Promise<void> {
  await openProjectPage("agents", "Agents");
  for (let removed = 0; removed < 10; removed++) {
    const actions = page.locator('[aria-label^="Actions for "]');
    if ((await actions.count()) === 0) return;
    await actions.first().click();
    await page.getByRole("menuitem", { name: "Delete" }).first().click();
    await page.getByTestId("cascade-archive-confirm-input").fill("delete");
    await page.getByTestId("cascade-archive-confirm-button").click();
    await expect(page.getByTestId("cascade-archive-confirm-button")).not.toBeVisible({
      timeout: 30000,
    });
  }
  throw new Error("the project still holds agents after ten deletions");
}

/** Opens Agent Testing and waits for the scenarios panel to settle. */
async function openAgentTesting(): Promise<void> {
  await visit(`/${projectSlug}/agent-testing`);
  await expect(page.getByTestId("agent-testing-title")).toBeVisible({ timeout: 90000 });

  // Branching before the panel settles reads every empty state as absent, and
  // the panel paints nothing at all while its reads are out, so a slow one is
  // indistinguishable from an empty project until it lands.
  const settled = page
    .getByTestId("agent-testing-connect-agent-empty")
    .or(page.getByTestId("agent-testing-first-suite-empty"))
    .or(page.getByTestId("agent-testing-first-case-empty"))
    .or(page.getByTestId("agent-testing-empty-suite"))
    .or(page.locator('[data-testid^="case-row-"]'))
    .first();
  try {
    await settled.waitFor({ state: "visible", timeout: 90000 });
  } catch {
    await page.reload({ waitUntil: "domcontentloaded" });
    await settled.waitFor({ state: "visible", timeout: 120000 });
  }
}

/** Names the first test suite when the project has none. */
async function ensureTestSuite(): Promise<void> {
  const suiteEmpty = page.getByTestId("agent-testing-first-suite-empty");
  if (!(await suiteEmpty.isVisible().catch(() => false))) return;

  await suiteEmpty.getByRole("button", { name: /new test suite/i }).click();
  const dialog = page.getByTestId("agent-testing-suite-name-dialog");
  await dialog.getByLabel("Test suite name").fill(SUITE_NAME);
  await dialog.getByTestId("suite-name-confirm").click();
  await expect(dialog).not.toBeVisible({ timeout: 20000 });
  await expect(
    page
      .getByTestId("agent-testing-first-case-empty")
      .or(page.locator('[data-testid^="case-row-"]'))
      .first(),
  ).toBeVisible({ timeout: 30000 });
}

/** Fills the scenario editor with the journey's scenario. */
async function writeScenario(): Promise<void> {
  await page
    .getByRole("button", { name: /new scenario/i })
    .first()
    .click();
  await page.getByLabel("Title").last().fill(SCENARIO_TITLE);
  await page
    .getByLabel("Situation")
    .last()
    .fill("The customer asks for a refund on a charge they do not recognise.");
  await page
    .getByLabel("Criteria")
    .last()
    .fill(["The agent acknowledges the charge", "The agent offers a refund"].join("\n"));
}

/** The journey's suite and scenario, created if the project has neither. */
async function ensureSuiteAndScenario(): Promise<void> {
  await openAgentTesting();
  if (
    await scenarioRow()
      .isVisible()
      .catch(() => false)
  )
    return;

  await ensureTestSuite();
  await writeScenario();

  // The editor stays open when the save click lands before the draft settles,
  // so the click is repeated until the row it creates is on the table.
  const save = page.getByTestId("case-modal-save").last();
  for (let attempt = 0; attempt < 3; attempt++) {
    if (
      await scenarioRow()
        .isVisible()
        .catch(() => false)
    )
      break;
    if (await save.isVisible().catch(() => false)) {
      await save.click().catch(() => undefined);
    }
    await scenarioRow()
      .waitFor({ state: "visible", timeout: 30000 })
      .catch(() => undefined);
  }
  await expect(scenarioRow()).toBeVisible({ timeout: 30000 });
}

/**
 * Navigates, retrying once. The ui lane compiles a route's chunk on its first
 * request, and on a loaded machine that first request can outlive even a
 * generous navigation budget while the second is instant.
 */
async function visit(path: string): Promise<void> {
  try {
    await page.goto(path, { waitUntil: "domcontentloaded" });
  } catch {
    await page.goto(path, { waitUntil: "domcontentloaded" });
  }
  // Signing back in lands wherever the sign-in decided, so the walk asks for
  // the page it wanted a second time.
  if (await recoverSession()) {
    await page.goto(path, { waitUntil: "domcontentloaded" }).catch(() => undefined);
  }
}

/**
 * Opens the sign-up form. A ui lane that is still optimising its dependencies
 * serves the shell before the modules behind it are ready, which paints an
 * empty document; one reload is enough once they are.
 */
async function openSignUp(): Promise<void> {
  await visit("/auth/signup");
  const heading = page.getByRole("heading", { name: /^sign up$/i });
  try {
    await heading.waitFor({ state: "visible", timeout: 45000 });
  } catch {
    await page.reload({ waitUntil: "domcontentloaded" });
    await heading.waitFor({ state: "visible", timeout: 90000 });
  }
}

/**
 * Signs back in when the walk has been bounced to the sign-in page. The api
 * lane restarts on any edit to its source, and a restart mid-walk drops the
 * session; the account and everything it owns survive, so the walk carries on.
 */
async function recoverSession(): Promise<boolean> {
  if (!accountExists) return false;
  if (!new URL(page.url()).pathname.startsWith("/auth/signin")) return false;

  // The bounce can land while the lane that serves the form is still coming
  // back, which paints an empty sign-in page; one reload is enough once it has.
  const email = page.getByLabel("Email");
  try {
    await email.waitFor({ state: "visible", timeout: 30000 });
  } catch {
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    await email.waitFor({ state: "visible", timeout: 90000 }).catch(() => undefined);
  }
  if (!(await email.isVisible().catch(() => false))) return false;

  await email.fill(ACCOUNT.email);
  await page.getByLabel("Password", { exact: true }).fill(ACCOUNT.password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page
    .waitForURL((url) => !url.pathname.startsWith("/auth/"), { timeout: 90000 })
    .catch(() => undefined);
  return true;
}

/** Whether the walk is inside a project rather than on the way to one. */
function inProject(): boolean {
  const first = new URL(page.url()).pathname.split("/")[1] ?? "";
  return first !== "" && !["onboarding", "auth", "settings"].includes(first);
}

function scenarioRow(): Locator {
  return page.getByTestId(`case-row-${SCENARIO_TITLE}`).first();
}

/**
 * Opens the run dialog on the journey's scenario, from the Run control the row
 * carries. Going through the editor would reopen it on a scenario that already
 * exists, which is a different question.
 */
async function openRunDialogForScenario(): Promise<Locator> {
  await page
    .getByRole("button", { name: `Run ${SCENARIO_TITLE}` })
    .first()
    .click();
  const dialog = page.getByTestId("run-case-dialog");
  await expect(dialog).toBeVisible({ timeout: 30000 });
  return dialog;
}

/**
 * Opens one of the project's pages and waits for its heading. A dev-mode lane
 * compiles the route's chunk on first request, which outlives the default
 * action timeout on a page nothing has visited yet.
 */
async function openProjectPage(path: string, heading: string): Promise<void> {
  await openPage(
    `/${projectSlug}/${path}`,
    page.getByRole("heading", { name: heading, exact: true }),
  );
}

/**
 * Opens a page and waits for what proves it arrived. The bounce to sign-in can
 * land after the navigation settles, when a lane restart drops the session, so
 * the walk signs back in and asks again rather than failing on the bounce.
 */
async function openPage(path: string, proof: Locator): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await visit(path);
    const arrived = await proof
      .first()
      .waitFor({ state: "visible", timeout: 45000 })
      .then(() => true)
      .catch(() => false);
    if (arrived) return;
    await recoverSession();
  }
  await expect(proof.first()).toBeVisible({ timeout: 45000 });
}

/** Creates an HTTP agent through the drawer a person uses. */
async function createHttpAgent(name: string, url: string): Promise<void> {
  await openProjectPage("agents", "Agents");
  await page
    .getByRole("button", { name: /new agent|create your first agent/i })
    .first()
    .click();
  const httpCard = page.getByTestId("agent-type-http");
  await expect(httpCard).toBeVisible({ timeout: 60000 });

  // The type card swaps one drawer for another, and a click that lands while
  // the first is still animating is dropped, so the editor is what is waited on.
  const nameInput = page.getByTestId("agent-name-input");
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await nameInput.isVisible().catch(() => false)) break;
    await httpCard.click().catch(() => undefined);
    await nameInput.waitFor({ state: "visible", timeout: 30000 }).catch(() => undefined);
  }
  await expect(nameInput).toBeVisible({ timeout: 30000 });
  await nameInput.fill(name);
  await page.getByTestId("url-input").fill(url);
  // Save is accepted and dropped while the form is still settling, so the
  // closed drawer is what says the agent was created.
  for (let attempt = 0; attempt < 4; attempt++) {
    if (!(await nameInput.isVisible().catch(() => false))) break;
    await page
      .getByTestId("save-agent-button")
      .click({ force: true })
      .catch(() => undefined);
    await nameInput.waitFor({ state: "hidden", timeout: 15000 }).catch(() => undefined);
  }
  await expect(nameInput).not.toBeVisible({ timeout: 20000 });
}

/** Picks one target in the run dialog by name and starts the run. */
async function pickAgentAndRun(agentName: string): Promise<void> {
  const dialog = page.getByTestId("run-case-dialog");
  const card = dialog
    .locator('[data-testid^="run-dialog-agent-"]')
    .filter({ hasText: agentName })
    .first();
  // The target list remounts while it settles, so a card can detach under the
  // click and a click that lands on the overlay closes the dialog; the walk
  // reopens it, and reads aria-pressed rather than the click for the answer.
  for (let attempt = 0; attempt < 5; attempt++) {
    if ((await card.getAttribute("aria-pressed").catch(() => null)) === "true") break;
    if (!(await dialog.isVisible().catch(() => false))) {
      await openRunDialogForScenario();
    }
    await card.waitFor({ state: "visible", timeout: 20000 }).catch(() => undefined);
    await card.click({ timeout: 10000 }).catch(() => undefined);
    await page.waitForTimeout(500);
  }
  await expect(card).toHaveAttribute("aria-pressed", "true", { timeout: 20000 });

  for (const other of await dialog.locator('[data-testid^="run-dialog-agent-"]').all()) {
    if ((await other.getAttribute("aria-pressed").catch(() => null)) !== "true") continue;
    if ((await other.textContent())?.includes(agentName)) continue;
    await other.click().catch(() => undefined);
  }
  const run = dialog.getByTestId("run-dialog-run");
  await expect(run).toBeEnabled({ timeout: 20000 });
  await run.click();
}

/**
 * Replaces what the code editor holds. `insertText` rather than `type`, so the
 * editor's own auto-indent and bracket closing do not rewrite the Python.
 */
async function fillCodeEditor(code: string): Promise<void> {
  const editor = page.locator(".monaco-editor").first();
  await expect(editor).toBeVisible({ timeout: 20000 });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(code);
}
