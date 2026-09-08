import type { Context } from "hono";
import type { z } from "zod";

export interface RestTransportMiddleware<Schema extends z.ZodType = z.ZodType> {
  readonly name: string;
  readonly schema: Schema;
}

export interface RestTransportMiddlewareBinding {
  readonly middleware: RestTransportMiddleware;
  resolve(context: Context): unknown | Promise<unknown>;
}

export function defineRestMiddleware<Schema extends z.ZodType>(
  name: string,
  schema: Schema,
): RestTransportMiddleware<Schema> {
  return Object.freeze({ name, schema });
}

/** A composition root binds request access; handlers receive only the parsed result. */
export function bindRestMiddleware<Schema extends z.ZodType>(
  middleware: RestTransportMiddleware<Schema>,
  resolve: (context: Context) => z.input<Schema> | Promise<z.input<Schema>>,
): RestTransportMiddlewareBinding {
  return { middleware, resolve };
}

export function bindRestHeader<Schema extends z.ZodType>(
  middleware: RestTransportMiddleware<Schema>,
  header: string,
): RestTransportMiddlewareBinding {
  return { middleware, resolve: (context) => context.req.header(header) ?? null };
}
