import type { Locator, Page } from "playwright";

import type { Action, ActionContext } from "./context.ts";
import { argument, asRegExp, escapeRegExp, fillPath, scope } from "./context.ts";
import { isTargeted, targetOf } from "./target.ts";

const CLICKABLE =
  "button, a, [role=button], [role=menuitem], [role=tab], [role=option], [role=radio]";

export const goTo = async ({
  context,
  path,
}: {
  context: ActionContext;
  path: string;
}): Promise<void> => {
  const { side, slug } = context;
  await side.goto(fillPath({ path, slug }));
  await side.page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
};

/** isClickable is a present, enabled control: a form refusing to save disables its button. */
const isClickable = async (target: Locator): Promise<boolean> =>
  (await target.count().catch(() => 0)) > 0 && (await target.isEnabled().catch(() => false));

export const clickText = async ({
  context,
  text,
  selector,
  optional,
}: {
  context: ActionContext;
  text: string;
  selector?: string;
  optional?: boolean;
}): Promise<void> => {
  const root = await scope(context.side.page);
  const pattern = asRegExp(text);
  let target = root
    .locator(selector ?? CLICKABLE)
    .filter({ hasText: pattern })
    .locator("visible=true")
    .first();
  if ((await target.count().catch(() => 0)) === 0) {
    target = root.getByText(pattern).locator("visible=true").first();
  }
  if (optional === true && !(await isClickable(target))) return;
  await target.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => undefined);
  await target.click({ timeout: 6000 });
};

export const fillField = async ({
  context,
  target,
  value,
}: {
  context: ActionContext;
  target: string;
  value: string;
}): Promise<void> => {
  const root = await scope(context.side.page);
  const pattern = asRegExp(target);
  const attempts = [
    () => root.getByPlaceholder(pattern).locator("visible=true").first(),
    () => root.getByLabel(pattern).locator("visible=true").first(),
    () =>
      root
        .locator(`input[name="${target}"], textarea[name="${target}"]`)
        .locator("visible=true")
        .first(),
  ];
  for (const attempt of attempts) {
    const field = attempt();
    if ((await field.count().catch(() => 0)) > 0) {
      await field.fill(value, { timeout: 6000 });
      return;
    }
  }
  throw new Error(`no field matching ${target}`);
};

export const go: Action = async (context) =>
  goTo({ context, path: argument({ context, name: "path" }) });

/** clickTarget clicks the named element; an optional one absent or disabled is skipped. */
const clickTarget = async ({
  context,
  optional,
}: {
  context: ActionContext;
  optional: boolean;
}): Promise<void> => {
  const target = targetOf({ root: context.side.page, args: context.args }).first();
  if (optional && !(await isClickable(target))) return;
  await target.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => undefined);
  await target.click({ timeout: 6000 });
};

export const click: Action = async (context) => {
  const optional = context.args.optional === "true";
  if (isTargeted(context.args)) return clickTarget({ context, optional });
  return clickText({
    context,
    text: argument({ context, name: "text" }),
    selector: context.args.selector,
    optional,
  });
};

export const fill: Action = async (context) => {
  const value = argument({ context, name: "value" });
  if (context.args.field !== undefined && !isTargeted(context.args)) {
    return fillField({ context, target: context.args.field, value });
  }
  await targetOf({ root: context.side.page, args: context.args })
    .first()
    .fill(value, { timeout: 6000 });
};

/** fieldPattern matches a field's label text whole, allowing the required marker after it. */
const fieldPattern = (field: string): RegExp =>
  /^\/.+\/[dgimsuvy]*$/.test(field)
    ? asRegExp(field)
    : new RegExp(String.raw`^\s*${escapeRegExp(field)}\s*\*?\s*$`, "i");

/** selectBox is the select a step names: by target, by the label text beside it, or the first. */
const selectBox = async (context: ActionContext): Promise<Locator> => {
  const { args, side } = context;
  if (isTargeted(args)) return targetOf({ root: side.page, args }).first();
  const root = await scope(side.page);
  if (args.field === undefined) return root.locator("select").locator("visible=true").first();
  return root
    .getByText(fieldPattern(args.field))
    .locator("visible=true")
    .first()
    .locator("xpath=ancestor::*[.//select or .//*[@role='combobox']][1]")
    .locator("select, [role=combobox]")
    .first();
};

/** select picks an option in a native select, or opens a combobox and picks the option in its list. */
export const select: Action = async (context) => {
  const option = argument({ context, name: "option" });
  const box = await selectBox(context);
  const native = await box.evaluate((node) => node.tagName === "SELECT", undefined, { timeout: 6000 });
  if (native) {
    const labels = (await box.locator("option").allTextContents()).map((label) => label.trim());
    const label = labels.find((text) => text === option) ?? labels.find((text) => asRegExp(option).test(text));
    if (label === undefined) throw new Error(`no option "${option}" among: ${labels.join(" | ")}`);
    await box.selectOption({ label }, { timeout: 6000 });
    return;
  }
  await box.click({ timeout: 6000 });
  await context.side.page.getByRole("option", { name: option }).first().click({ timeout: 6000 });
};

/** type puts text into a box (placeholder, test id, label or selector) and optionally submits it. */
export const type: Action = async (context) => {
  const { side } = context;
  const box = isTargeted(context.args)
    ? targetOf({ root: side.page, args: context.args }).first()
    : side.page.getByPlaceholder(asRegExp(argument({ context, name: "placeholder" }))).first();
  await box.click({ timeout: 6000 });
  await side.page.keyboard.type(argument({ context, name: "text" }), { delay: 12 });
  if (context.args.submit === "true") await side.page.keyboard.press("Enter");
};

export const wait: Action = async (context) => {
  await context.side.page.waitForTimeout(
    Number(argument({ context, name: "millis", fallback: "500" })),
  );
};

/** PASSKEY_OFFER is the dialog a password sign-in is offered a passkey in. */
export const passkeyOffer = (page: Page): Locator =>
  page.getByRole("dialog").filter({ hasText: "Sign in faster next time" });

/**
 * declinePasskeyOffer answers "Not now" when the offer shows within probeMillis.
 * main shows it again on every screen, so every capture asks before its screenshot.
 */
export const declinePasskeyOffer = async ({
  page,
  probeMillis,
}: {
  page: Page;
  probeMillis: number;
}): Promise<boolean> => {
  const dialog = passkeyOffer(page);
  const shown = await dialog
    .waitFor({ state: "visible", timeout: probeMillis })
    .then(() => true)
    .catch(() => false);
  if (!shown) return false;
  await dialog.getByRole("button", { name: "Not now", exact: true }).click({ timeout: 3000 });
  await dialog.waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
  return true;
};

/** dismissTour clears the product tour, which otherwise covers every screen behind it. */
export const dismissTour: Action = async (context) => {
  for (const label of ["Skip tour", "Skip", "Got it", "Dismiss"]) {
    const button = context.side.page.getByRole("button", { name: label, exact: true }).first();
    if ((await button.count().catch(() => 0)) === 0) continue;
    await button.click({ timeout: 3000 }).catch(() => undefined);
    return;
  }
};
