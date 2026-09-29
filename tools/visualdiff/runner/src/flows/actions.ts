import type { Action } from "./context";
import { argument, scope } from "./context";
import { clickText, dismissTour, fillField, goTo } from "./primitives";

const required = async (context: Parameters<Action>[0], text: string): Promise<void> =>
  clickText({ context, text });

/** signIn signs the run in, signing up first when the account does not exist yet. */
export const signIn: Action = async (context) => {
  const { credential } = context;
  await goTo({ context, path: "/auth/signin" });
  await context.side.page
    .locator("input")
    .locator("visible=true")
    .first()
    .waitFor({ timeout: 15_000 })
    .catch(() => undefined);
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

export const createAutomation: Action = async (context) => {
  await goTo({ context, path: "/{slug}/traces" });
  await clickText({ context, text: "Automate" });
  await context.snapshot("automation drawer");
  if (context.args.kind === "alert") {
    await required(context, "Watch a metric");
    await context.snapshot("alert form");
  } else {
    // Choosing the type re-renders the form, so it comes before the name.
    await required(context, "Act on each matching trace");
  }
  // By its label: the placeholder names an example, and each kind shows its own.
  await fillField({ context, target: "/^Name$/", value: argument({ context, name: "name" }) });
  const cadence = context.args.cadence;
  if (cadence !== undefined) await chooseOption({ context, option: cadence });
  const settleWindow = context.args.settleWindow;
  if (settleWindow !== undefined) {
    const root = await scope(context.side.page);
    await root
      .locator('input[type="number"]')
      .locator("visible=true")
      .first()
      .fill(settleWindow, { timeout: 6000 });
  }
  await context.snapshot("automation filled in");
  // submit "none" leaves the drawer open for the steps that set its subject.
  const fallback = context.args.kind === "alert" ? "Create alert" : "Create automation";
  const submit = argument({ context, name: "submit", fallback });
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

export const annotate: Action = async (context) => {
  await goTo({ context, path: `/{slug}/traces/${argument({ context, name: "traceId" })}` });
  await required(context, "/^(Annotate|Add annotation|Annotations)/");
  await context.snapshot("annotation form");
  const comment = argument({ context, name: "comment", fallback: "Visual diff note" });
  await context.side.page
    .locator("textarea")
    .last()
    .fill(`${comment} (${context.side.name})`, { timeout: 8000 });
  await required(context, "/^(Save|Add|Submit|Comment)/");
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
    path: argument({ context, name: "start", fallback: "/{slug}/analytics/query" }),
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
  await required(context, "Add chart");
  await context.snapshot("after adding a chart");
};

export { dismissTour };
