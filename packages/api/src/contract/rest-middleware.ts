/**
 * What a route asks the process for beyond its own input, DECLARED — a frozen
 * name and schema, so it belongs on the browser-safe half: a contract that
 * declares one must not drag the REST runtime into every browser.
 */

import type { z } from "zod";

export interface RestTransportMiddleware<Schema extends z.ZodType = z.ZodType> {
  readonly name: string;
  readonly schema: Schema;
  readonly source?: "headers";
}

export function defineRestMiddleware<Schema extends z.ZodType>(
  name: string,
  schema: Schema,
): RestTransportMiddleware<Schema> {
  return Object.freeze({ name, schema });
}
