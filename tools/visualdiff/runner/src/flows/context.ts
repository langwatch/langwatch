import type { Locator, Page } from "playwright";

import type { Side } from "../capture";
import type { Credential, Plan } from "../protocol";

export interface ActionContext {
  side: Side;
  slug: string;
  credential: Credential;
  /** args are the step's arguments with every placeholder filled (values.ts). */
  args: Record<string, string>;
  /** values are the flow's captured strings, by name; a later step's placeholders read them. */
  values: Record<string, string>;
  /** mailUrl is the side's mail sink (services/mailsim), absent where the stack has none. */
  mailUrl?: string;
  /** snapshot photographs the screen mid-action, so a wizard's every page is evidence. */
  snapshot: (label: string) => Promise<void>;
}

export type Action = (context: ActionContext) => Promise<void>;

const DIALOG = "[role=dialog], .chakra-drawer__content, [data-scope=dialog][data-part=content]";

/**
 * scope narrows every locator to the topmost visible dialog, so a step never
 * grabs the control of the same name on the page behind it.
 */
export const scope = async (page: Page): Promise<Page | Locator> => {
  const count = await page
    .locator(DIALOG)
    .count()
    .catch(() => 0);
  for (let index = count - 1; index >= 0; index--) {
    const dialog = page.locator(DIALOG).nth(index);
    if (!(await dialog.isVisible().catch(() => false))) continue;
    const text = (await dialog.innerText().catch(() => "")) ?? "";
    if (text.trim().length > 40) return dialog;
  }
  return page;
};

export const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const asRegExp = (value: string): RegExp =>
  /^\/.+\/[dgimsuvy]*$/.test(value)
    ? new RegExp(value.slice(1, value.lastIndexOf("/")), value.slice(value.lastIndexOf("/") + 1))
    : new RegExp(escapeRegExp(value), "i");

/** fillPath substitutes the project slug and any seeded fixture ids into a configured path. */
export const fillPath = ({
  path,
  slug,
  fixtures = {},
}: {
  path: string;
  slug: string;
  fixtures?: Record<string, string>;
}): string =>
  Object.entries(fixtures).reduce(
    (filled, [name, value]) => filled.replaceAll(`{${name}}`, value),
    path.replaceAll("{slug}", slug),
  );

/** sideFixtures are the plan's static fixtures with one side's seeded ids over them. */
export const sideFixtures = ({
  plan,
  side,
}: {
  plan: Pick<Plan, "fixtures" | "sides">;
  side: string;
}): Record<string, string> => ({
  ...plan.fixtures,
  ...plan.sides.find((candidate) => candidate.name === side)?.fixtures,
});

export const argument = ({
  context,
  name,
  fallback,
}: {
  context: ActionContext;
  name: string;
  fallback?: string;
}): string => {
  const value = context.args[name];
  if (value !== undefined) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`action needs a "${name}" argument`);
};
