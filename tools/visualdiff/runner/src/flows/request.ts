import type { Action } from "./context.ts";
import { argument, fillPath } from "./context.ts";
import { judgeBody, readField } from "./expect.ts";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/**
 * request sends an API call the UI cannot make, as the step's page (`auth` is X-Auth-Token).
 * `method` defaults to POST, `body` is JSON text, `path` takes {slug}, `status` defaults to any
 * 2xx. `field` with `equals`, `contains` or `min` judges the reply; `as` keeps `field` as `{as}`.
 */
export const request: Action = async (context) => {
  const { args, side } = context;
  const method = (args.method ?? "POST").toUpperCase();
  if (!METHODS.includes(method)) throw new Error(`request: unknown method "${method}"`);
  const path = fillPath({ path: argument({ context, name: "path" }), slug: context.slug });
  const headers: Record<string, string> =
    args.auth === undefined ? {} : { "X-Auth-Token": args.auth };
  if (args.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await side.page.request.fetch(side.baseUrl + path, {
    method,
    headers,
    data: args.body,
    failOnStatusCode: false,
    ignoreHTTPSErrors: true,
  });
  const status = response.status();
  const label = `${method} ${path}`;
  const refused = args.status === undefined ? !response.ok() : String(status) !== args.status;
  if (refused) {
    const text = (await response.text().catch(() => "")).slice(0, 120);
    throw new Error(`request ${label} answered ${status}, want ${args.status ?? "2xx"}: ${text}`);
  }
  const body: unknown = await response.json().catch(() => undefined);
  if (["equals", "contains", "min"].some((key) => args[key] !== undefined)) {
    const why = judgeBody({ body, args });
    if (why !== "") throw new Error(`request ${label}: ${why}`);
  }
  if (args.as === undefined) return;
  const kept = readField({ body, path: args.field });
  if (kept === undefined || kept === null || kept === "") {
    throw new Error(
      `request ${label}: nothing at ${args.field ?? "the body"} to keep as ${args.as}`,
    );
  }
  context.values[args.as] = typeof kept === "string" ? kept : JSON.stringify(kept);
};
