/**
 * What a route asks the process for beyond its own input, DECLARED. The
 * declaration is a frozen name and schema and nothing else, so it belongs on
 * the browser-safe half: a contract that declares one must not drag the REST
 * runtime, and with it `node:async_hooks`, into every browser that imports it.
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
