/**
 * What a route asks its module for beyond its own input, DECLARED: a frozen name and schema, so
 * it belongs on the browser-safe half. A contract that declares one must not drag the REST
 * runtime into every browser. The module supplies it with `.provideMiddlewareContext` (§8).
 */

import type { z } from "zod";

export interface MiddlewareContext<
  Name extends string = string,
  Schema extends z.ZodType = z.ZodType,
> {
  readonly name: Name;
  readonly schema: Schema;
  /** Unset: read off the credential alone, so a public route resolves it before the body (§8). */
  readonly source?: "headers" | "input";
}

export function defineMiddlewareContext<const Name extends string, Schema extends z.ZodType>(
  name: Name,
  schema: Schema,
  options?: { source: "input" },
): MiddlewareContext<Name, Schema> {
  return Object.freeze({ name, schema, ...options });
}
