import { createHash } from "node:crypto";

/** RUN_TOKEN tells this runner process from the last, so a reused stack never sees a name twice. */
const RUN_TOKEN = Date.now().toString(36).slice(-5);

/** uidFor is `{uid}`: one token per run and flow, the same on both sides. */
export const uidFor = (flowId: string): string =>
  RUN_TOKEN + createHash("sha1").update(flowId).digest("hex").slice(0, 3);

/** fillValues substitutes each `{name}` a value is given for; any other braces stay. */
export const fillValues = ({
  text,
  values,
}: {
  text: string;
  values: Record<string, string>;
}): string =>
  Object.entries(values).reduce((filled, [name, value]) => filled.replaceAll(`{${name}}`, value), text);

/** fillArgs fills every argument of a step. */
export const fillArgs = ({
  args,
  values,
}: {
  args: Record<string, string>;
  values: Record<string, string>;
}): Record<string, string> =>
  Object.fromEntries(
    Object.entries(args).map(([name, text]) => [name, fillValues({ text, values })]),
  );

/** ISOLATED_SLUG and ISOLATED_KEY are the fixtures the seed's second project fills. */
export const ISOLATED_SLUG = "isolatedSlug";
export const ISOLATED_KEY = "isolatedProjectKey";
