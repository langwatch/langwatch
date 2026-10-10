import { join } from "node:path";

import type { ColorScheme, ColorSchemeChoice, Plan } from "./protocol.ts";

/** DARK_SUFFIX ends the key of a dark capture in a `both` run, so the two passes never share a
 * baseline slot, a pairing identity or a screenshot file. */
export const DARK_SUFFIX = "@dark";

/** passesFor lists the schemes a run captures, in the order it captures them. */
export const passesFor = (choice: ColorSchemeChoice | undefined): ColorScheme[] =>
  choice === "both" ? ["light", "dark"] : [choice ?? "light"];

/** withoutScheme is the configured route or flow id behind a (possibly dark) capture key. */
export const withoutScheme = (key: string): string =>
  key.endsWith(DARK_SUFFIX) ? key.slice(0, -DARK_SUFFIX.length) : key;

const isDarkPassOfBoth = ({ plan, scheme }: { plan: Plan; scheme: ColorScheme }): boolean =>
  plan.colorScheme === "both" && scheme === "dark";

/**
 * passPlan is the plan one pass runs on: its scheme made concrete, and in a `both` run the dark
 * pass's screenshots under their own directory.
 */
export const passPlan = ({ plan, scheme }: { plan: Plan; scheme: ColorScheme }): Plan => ({
  ...plan,
  colorScheme: scheme,
  outDir: isDarkPassOfBoth({ plan, scheme }) ? join(plan.outDir, "dark") : plan.outDir,
});

/** keyed carries the dark pass's scheme on every capture it reports, in a `both` run only. */
export const keyed = <Message extends { key: string }>({
  collect,
  plan,
  scheme,
}: {
  collect: (message: Message) => void;
  plan: Plan;
  scheme: ColorScheme;
}): ((message: Message) => void) =>
  isDarkPassOfBoth({ plan, scheme })
    ? (message) => collect({ ...message, key: `${message.key}${DARK_SUFFIX}` })
    : collect;
