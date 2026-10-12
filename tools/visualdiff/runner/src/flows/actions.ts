import type { Action } from "./context.ts";
import { argument, scope } from "./context.ts";
import { clickText, dismissTour, fillField, goTo } from "./primitives.ts";

/** ADD_CHART_DRAWER_BUTTON is "Add chart" once the playground flag has resolved to the drawer. */
const ADD_CHART_DRAWER_BUTTON = 'button:not([href]):has-text("Add chart")';

const required = async (context: Parameters<Action>[0], text: string): Promise<void> =>
  clickText({ context, text });

/**
 * signIn signs the run in, signing up first when the account does not exist yet. The `email`
 * and `password` arguments sign in as another account, for a flow that made its own.
 */
export const signIn: Action = async (context) => {
  const credential = {
    ...context.credential,
    email: context.args.email ?? context.credential.email,
    password: context.args.password ?? context.credential.password,
  };
  const formShown = async (): Promise<boolean> => {
    await goTo({ context, path: "/auth/signin" });
    return context.side.page
      .locator("input")
      .locator("visible=true")
      .first()
      .waitFor({ timeout: 15_000 })
      .then(
        () => true,
        () => false,
      );
  };
  // A cold dev server can fail the first page's module import; one reload recovers it.
  if (!(await formShown())) await formShown();
  await context.snapshot("sign in");
  const filled = await fillField({ context, target: "email", value: credential.email }).then(
    () => true,
    () => false,
  );
  if (!filled) {
    await goTo({ context, path: "/auth/signup" });
    await fillField({ context, target: "name", value: "Visual Diff" });
    await fillField({ context, target: "email", value: credential.email });
    await fillField({ context, target: "password", value: credential.password });
    await fillField({ context, target: "confirmPassword", value: credential.password });
    await clickText({ context, text: "Sign up" });
    await context.snapshot("after sign up");
    return;
  }
  const passwordShown = await fillField({
    context,
    target: "password",
    value: credential.password,
  }).then(
    () => true,
    () => false,
  );
  if (!passwordShown) {
    // Identifier-first sign-in (main): the address step answers before the password shows.
    await clickText({ context, text: "Continue" });
    await context.side.waitUntilQuiet();
    await fillField({ context, target: "password", value: credential.password });
  }
  await clickText({ context, text: String.raw`/^\s*(sign in|log in)\s*$/i` });
  await context.snapshot("after sign in");
};

/** chooseOption picks option in the dialog's first select box, or closes a list without it. */
const chooseOption = async ({
  context,
  option,
}: {
  context: Parameters<Action>[0];
  option: string;
}): Promise<void> => {
  const { page } = context.side;
  const root = await scope(page);
  await root.locator("[role=combobox]").locator("visible=true").first().click({ timeout: 6000 });
  const chosen = await page
    .getByRole("option", { name: option })
    .first()
    .click({ timeout: 3000 })
    .then(
      () => true,
      () => false,
    );
  if (!chosen) await page.keyboard.press("Escape");
};

/**
 * createAutomation opens the Add automation wizard from the traces toolbar and names it. `kind:
 * alert` picks the "A graph" watch. `cadence` and `settleWindow` live on the Delivery step, so
 * either one moves the wizard there (the subject must already be set) and leaves it open.
 */
export const createAutomation: Action = async (context) => {
  const { page } = context.side;
  await goTo({ context, path: "/{slug}/traces" });
  await dismissTour(context);
  await clickText({ context, text: String.raw`/^\s*Automate\s*$/` });
  await context.snapshot("automation drawer");
  const name = page.getByTestId("automation-name-input");
  await name.waitFor({ state: "visible", timeout: 10_000 });
  await name.fill(argument({ context, name: "name" }), { timeout: 6000 });
  if (context.args.kind === "alert") {
    await clickText({ context, text: "A graph" });
    await context.snapshot("alert form");
  }
  const cadence = context.args.cadence;
  const settleWindow = context.args.settleWindow;
  if (cadence !== undefined || settleWindow !== undefined) {
    await clickText({ context, text: String.raw`/^\s*Continue\s*$/` });
    await page
      .getByTestId("automation-delivery-send-email")
      .waitFor({ state: "visible", timeout: 10_000 });
    if (cadence !== undefined) await chooseOption({ context, option: cadence });
    if (settleWindow !== undefined) {
      await fillField({ context, target: "Settle window", value: settleWindow });
    }
  }
  await context.snapshot("automation filled in");
  // submit "none" leaves the wizard open for the steps that set the subject and delivery.
  const submit = argument({ context, name: "submit", fallback: "none" });
  if (submit !== "none") await required(context, submit);
  await context.snapshot("after create");
};

export const createEvaluation: Action = async (context) => {
  await goTo({
    context,
    path: argument({ context, name: "start", fallback: "/{slug}/online-evaluations" }),
  });
  await required(context, "New Online Evaluation");
  await context.snapshot("online evaluation drawer");
};

/** sendTrace opens the seeded trace list: it shows no trace ids to click, openTrace reads one. */
export const sendTrace: Action = async (context) => {
  await goTo({ context, path: "/{slug}/traces" });
  await context.snapshot("trace list");
};

/** openTrace opens a trace by its address: the list shows no trace ids to click. */
export const openTrace: Action = async (context) => {
  await goTo({ context, path: `/{slug}/traces/${argument({ context, name: "traceId" })}` });
  await context.snapshot("trace drawer");
  await context.snapshot("spans tab");
};

/** annotate opens the trace drawer by its address and comments on the trace input. */
export const annotate: Action = async (context) => {
  const { page } = context.side;
  await goTo({ context, path: `/{slug}/traces/${argument({ context, name: "traceId" })}` });
  const control = page.getByTestId("anchor-comment-button").first();
  await control.waitFor({ state: "visible", timeout: 15_000 });
  await control.click({ timeout: 6000 });
  await context.snapshot("annotation form");
  const comment = argument({ context, name: "comment", fallback: "Visual diff note" });
  await page
    .locator('textarea[placeholder="Optional"]')
    .first()
    .fill(`${comment} (${context.side.name})`, { timeout: 8000 });
  await page.locator('button:text-is("Save")').first().click({ timeout: 6000 });
  await context.snapshot("after annotating");
};

export const editProjectSettings: Action = async (context) => {
  await goTo({ context, path: "/settings" });
  await context.snapshot("organization settings");
  await context.side.page
    .locator('input[name="name"], input[name="displayName"]')
    .first()
    .fill(`${argument({ context, name: "name" })} ${context.side.name}`, { timeout: 6000 });
  await required(context, "/^(Update|Save)/");
  await context.snapshot("after saving");
};

export const createPrompt: Action = async (context) => {
  await goTo({ context, path: "/{slug}/prompts" });
  // An empty project offers its first prompt instead.
  await clickText({ context, text: String.raw`/^\s*(New Prompt|Create First Prompt)\s*$/i` });
  await context.snapshot("prompt editor");
  await context.side.page
    .locator("textarea")
    .first()
    .fill(argument({ context, name: "message", fallback: "You are the visual-diff assistant." }), {
      timeout: 8000,
    });
  await required(context, String.raw`/^\s*Save\s*$/`);
  // Saving a new prompt asks for its handle, then saves again from the dialog.
  await context.side.page
    .getByPlaceholder("prompt-name")
    .fill(argument({ context, name: "handle", fallback: "vd-prompt" }), { timeout: 8000 });
  await required(context, String.raw`/^\s*Save\s*$/`);
  await context.snapshot("after saving");
};

export const createExperiment: Action = async (context) => {
  await goTo({ context, path: "/{slug}/experiments" });
  await context.snapshot("experiments");
  await required(context, "New Experiment");
  await context.snapshot("new experiment");
};

export const createPairwise: Action = async (context) => {
  await goTo({
    context,
    path: argument({ context, name: "start", fallback: "/{slug}/experiments/workbench" }),
  });
  await context.snapshot("workbench");
  // A comparison is a target: the targets header's Add opens the type picker it sits in.
  await context.side.page
    .getByText("Prompts or Agents", { exact: true })
    .locator("xpath=..")
    .getByRole("button", { name: /^\s*Add\b/ })
    .first()
    .click({ timeout: 6000 });
  await context.snapshot("target types");
  await clickText({ context, text: String.raw`/^\s*Comparison/` });
  await context.snapshot("comparisons");
  await clickText({ context, text: "New Comparison" });
  await context.snapshot("comparison editor");
};

export const createScenario: Action = async (context) => {
  await goTo({
    context,
    path: argument({ context, name: "start", fallback: "/{slug}/agent-testing" }),
  });
  await context.snapshot("agent testing");
  await goTo({ context, path: "/{slug}/simulations/scenarios" });
  await context.snapshot("scenarios");
};

export const createRunSet: Action = async (context) => {
  await goTo({
    context,
    path: argument({ context, name: "start", fallback: "/{slug}/analytics/reports" }),
  });
  await context.snapshot("query surface");
  const editor = context.side.page.locator("textarea, .cm-content, [contenteditable=true]").first();
  await editor.click({ timeout: 6000 });
  await context.side.page.keyboard.type(
    argument({ context, name: "query", fallback: "SELECT 1" }),
    {
      delay: 12,
    },
  );
  await required(context, "/^(Run|Execute)/");
  await context.snapshot("after running");
};

export const createDashboard: Action = async (context) => {
  await goTo({
    context,
    path: argument({ context, name: "start", fallback: "/{slug}/analytics/reports" }),
  });
  await context.snapshot("chart builder");
  // Until the playground flag resolves, "Add chart" is a link (a button carrying an href).
  await context.side.page
    .locator(ADD_CHART_DRAWER_BUTTON)
    .first()
    .waitFor({ state: "visible", timeout: 30_000 })
    .catch(() => undefined);
  await required(context, "Add chart");
  await context.snapshot("after adding a chart");
};

export { dismissTour };
