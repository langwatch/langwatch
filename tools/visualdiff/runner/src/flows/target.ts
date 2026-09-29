import type { Locator, Page } from "playwright";

import { asRegExp } from "./context.ts";

const TARGET_KEYS = ["testId", "testIdPrefix", "label"] as const;

/** hasTarget is a step naming its element by test id or aria label, not by its text. */
export const hasTarget = (args: Record<string, string>): boolean =>
  TARGET_KEYS.some((key) => args[key] !== undefined);

/** isTargeted adds a raw `selector` with no `text` to hasTarget: the step names an element. */
export const isTargeted = (args: Record<string, string>): boolean =>
  hasTarget(args) || (args.selector !== undefined && args.text === undefined);

const quoted = (value: string): string => value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');

/**
 * targetOf is the elements a step names: `testId` (exact), `testIdPrefix` (a row family),
 * `label` (aria-label or a form label; exact unless written /regex/) or a raw `selector`,
 * narrowed by `hasText`. Visible elements only, unless a hidden input is the point.
 */
export const targetOf = ({
  root,
  args,
  visible = true,
}: {
  root: Page | Locator;
  args: Record<string, string>;
  visible?: boolean;
}): Locator => {
  let target: Locator;
  if (args.testId !== undefined) {
    target = root.locator(`[data-testid="${quoted(args.testId)}"]`);
  } else if (args.testIdPrefix !== undefined) {
    target = root.locator(`[data-testid^="${quoted(args.testIdPrefix)}"]`);
  } else if (args.label !== undefined) {
    const regex = /^\/.+\/[dgimsuvy]*$/.test(args.label);
    target = regex ? root.getByLabel(asRegExp(args.label)) : root.getByLabel(args.label, { exact: true });
  } else if (args.selector !== undefined) {
    target = root.locator(args.selector);
  } else {
    throw new Error("name the element: testId, testIdPrefix, label or selector");
  }
  if (args.hasText !== undefined) target = target.filter({ hasText: asRegExp(args.hasText) });
  return visible ? target.locator("visible=true") : target;
};
