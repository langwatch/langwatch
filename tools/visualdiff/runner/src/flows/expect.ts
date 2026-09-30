import type { Action, ActionContext } from "./context.ts";
import { asRegExp, fillPath } from "./context.ts";
import { hasTarget, targetOf } from "./target.ts";

/** EXPECT_TIMEOUT_MILLIS bounds how long an expect polls before it fails. */
export const EXPECT_TIMEOUT_MILLIS = 10_000;

/** POLL_MILLIS is the gap between two reads of a polled expect. */
const POLL_MILLIS = 250;

/** The keys an expect step may carry; tools/visualdiff/config.go refuses any other. */
export const EXPECT_FORMS = [
  "text",
  "count",
  "url",
  "api",
  "testId",
  "testIdPrefix",
  "label",
] as const;

const TARGET_FORMS = ["testId", "testIdPrefix", "label"] as const;

/** hasBodyCheck is an api expect that reads the body, not only the status. */
const hasBodyCheck = (args: Record<string, string>): boolean =>
  ["field", "contains", "equals", "min"].some((key) => args[key] !== undefined);

/**
 * describeExpect is an expect's one-line proof, the same on both sides:
 * `text "VD Alert"`, `count role=row >= 3`, `url /traces`, `api /api/triggers contains "VD"`,
 * `testId trace-row >= 1`, `api /api/triggers status 401`.
 */
export const describeExpect = (args: Record<string, string>): string => {
  const bound = args.equals !== undefined ? ` == ${args.equals}` : ` >= ${args.min ?? "1"}`;
  if (args.text !== undefined) {
    const within = args.role === undefined ? "" : ` within ${args.role} "${args.name ?? ""}"`;
    return `text "${args.text}"${within}${args.equals === undefined ? "" : bound}`;
  }
  const element = TARGET_FORMS.find((form) => args[form] !== undefined);
  if (element !== undefined) {
    const narrowed = args.hasText === undefined ? "" : ` with text "${args.hasText}"`;
    return `${element} ${args[element]}${narrowed}${bound}`;
  }
  if (args.count !== undefined) return `count ${args.count}${bound}`;
  if (args.url !== undefined) return `url ${args.url}`;
  if (args.api !== undefined) {
    const field = args.field === undefined ? "" : ` ${args.field}`;
    if (args.status !== undefined && !hasBodyCheck(args))
      return `api ${args.api} status ${args.status}`;
    if (args.contains !== undefined) return `api ${args.api}${field} contains "${args.contains}"`;
    if (args.equals !== undefined) return `api ${args.api}${field} == ${args.equals}`;
    return `api ${args.api}${field} length >= ${args.min ?? "1"}`;
  }
  return `unknown expect (${Object.keys(args).join(", ")})`;
};

/** readField walks a dotted path ("data.0.name") into a parsed JSON body. */
export const readField = ({ body, path }: { body: unknown; path?: string }): unknown => {
  if (path === undefined || path === "") return body;
  let value: unknown = body;
  for (const part of path.split(".")) {
    if (value === null || typeof value !== "object") return undefined;
    value = Reflect.get(value, Array.isArray(value) ? Number(part) : part);
  }
  return value;
};

const sizeOf = (value: unknown): number => {
  if (Array.isArray(value)) return value.length;
  if (typeof value === "number") return value;
  if (value !== null && typeof value === "object") return Object.keys(value).length;
  return value === undefined || value === null || value === "" ? 0 : 1;
};

/** judgeCount is "" when a count meets its bound, or why it does not. */
export const judgeCount = ({
  found,
  args,
}: {
  found: number;
  args: Record<string, string>;
}): string => {
  if (args.equals !== undefined) {
    return found === Number(args.equals) ? "" : `found ${found}, want ${args.equals}`;
  }
  const min = Number(args.min ?? "1");
  return found >= min ? "" : `found ${found}, want at least ${min}`;
};

/** judgeBody is "" when an api expect's field holds, or why it does not. */
export const judgeBody = ({
  body,
  args,
}: {
  body: unknown;
  args: Record<string, string>;
}): string => {
  const value = readField({ body, path: args.field });
  if (args.contains !== undefined) {
    const text = JSON.stringify(value) ?? "";
    return text.includes(args.contains) ? "" : `${args.field ?? "body"} lacks "${args.contains}"`;
  }
  if (args.equals !== undefined) {
    const text = typeof value === "string" ? value : (JSON.stringify(value) ?? "undefined");
    return text === args.equals ? "" : `${args.field ?? "body"} is ${text.slice(0, 80)}`;
  }
  return judgeCount({ found: sizeOf(value), args });
};

/** readOnce checks an expect once against the side's current page: "" when it holds. */
const readOnce = async (context: ActionContext): Promise<string> => {
  const { args, side } = context;
  const page = side.page;
  if (args.text !== undefined) {
    const scoped = page.locator(`role=${args.role ?? ""}`);
    const within =
      args.name === undefined ? scoped : scoped.filter({ hasText: asRegExp(args.name) });
    const root = args.role === undefined ? page : within;
    const visible = await root
      .getByText(asRegExp(args.text))
      .locator("visible=true")
      .count()
      .catch(() => 0);
    return judgeCount({ found: visible, args });
  }
  if (hasTarget(args)) {
    const found = await targetOf({ root: page, args })
      .count()
      .catch(() => 0);
    return judgeCount({ found, args });
  }
  if (args.count !== undefined) {
    const found = await page
      .locator(args.count)
      .locator("visible=true")
      .count()
      .catch(() => 0);
    return judgeCount({ found, args });
  }
  if (args.url !== undefined) {
    const path = new URL(page.url()).pathname;
    const wanted = asRegExp(fillPath({ path: args.url, slug: context.slug }));
    return wanted.test(path) ? "" : `on ${path}`;
  }
  if (args.api !== undefined) {
    const token = args.auth ?? context.credential.projectKey;
    const response = await page.request.get(
      side.baseUrl + fillPath({ path: args.api, slug: context.slug }),
      {
        headers: token === "none" ? {} : { "X-Auth-Token": token },
        failOnStatusCode: false,
        ignoreHTTPSErrors: true,
      },
    );
    if (args.status !== undefined && String(response.status()) !== args.status) {
      return `answered ${response.status()}, want ${args.status}`;
    }
    if (args.status === undefined && !response.ok()) return `answered ${response.status()}`;
    if (args.status !== undefined && !hasBodyCheck(args)) return "";
    return judgeBody({ body: await response.json().catch(() => undefined), args });
  }
  return `no form: give one of ${EXPECT_FORMS.join(", ")}`;
};

/**
 * pollExpect reads an expect until it holds or `timeout` millis run out, then
 * throws "expect <description>: <why> after <timeout>ms", the step's failure.
 */
export const pollExpect = async ({
  read,
  args,
  timeout,
}: {
  read: () => Promise<string>;
  args: Record<string, string>;
  timeout: number;
}): Promise<void> => {
  const deadline = Date.now() + timeout;
  let why = await read();
  while (why !== "" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MILLIS));
    why = await read();
  }
  if (why !== "") throw new Error(`expect ${describeExpect(args)}: ${why} after ${timeout}ms`);
};

/** expectOutcome is the `expect` step: its `timeout` millis, EXPECT_TIMEOUT_MILLIS otherwise. */
export const expectOutcome: Action = async (context) =>
  pollExpect({
    read: () => readOnce(context),
    args: context.args,
    timeout: Number(context.args.timeout ?? EXPECT_TIMEOUT_MILLIS),
  });
