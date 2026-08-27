import type { Context, MiddlewareHandler } from "hono";
import { uniqueSymbol, validator as zValidator } from "hono-openapi";
import { z } from "zod";

import { routeParameterNames } from "./definition.js";
import { createApiSchemaError, parseApiSchema, type ApiSchema } from "./schema.js";
import type { EndpointRegistration } from "./types.js";

export function appendPublicRestDocumentationValidators({
  stack,
  endpoint,
}: {
  stack: MiddlewareHandler[];
  endpoint: EndpointRegistration;
}): void {
  const input = endpoint.config.input;
  if (!(input instanceof z.ZodObject)) {
    return;
  }

  const parameterNames = new Set(routeParameterNames(endpoint.path));
  const parameterShape: Record<string, z.ZodType> = {};
  const sourceShape: Record<string, z.ZodType> = {};
  for (const [name, field] of Object.entries(input.shape)) {
    const target = parameterNames.has(name) ? parameterShape : sourceShape;
    target[name] = field;
  }

  if (Object.keys(parameterShape).length > 0) {
    stack.push(documentationValidator("param", z.object(parameterShape)));
  }
  if (Object.keys(sourceShape).length > 0) {
    const target = endpoint.method === "get" ? "query" : "json";
    stack.push(documentationValidator(target, z.object(sourceShape)));
  }
}

function documentationValidator(
  target: "param" | "query" | "json",
  schema: z.ZodObject,
): MiddlewareHandler {
  const documented = zValidator(target, schema);
  const middleware: MiddlewareHandler = async (_context, next) => {
    await next();
  };
  const metadata: unknown = Reflect.get(documented, uniqueSymbol);
  if (metadata !== void 0) {
    Object.defineProperty(middleware, uniqueSymbol, { value: metadata });
  }
  return middleware;
}

export function publicRestPathParams({
  context,
  source,
}: {
  context: Context;
  source: "route" | "context";
}): unknown {
  return source === "route" ? context.req.param() : context.get("routeParams");
}

export async function parsePublicRestInput({
  context,
  method,
  params,
  schema,
}: {
  context: Context;
  method: EndpointRegistration["method"];
  params: unknown;
  schema: ApiSchema | undefined;
}): Promise<unknown> {
  if (!schema) {
    return void 0;
  }

  const source = method === "get" ? context.req.query() : await readJsonObject(context);
  const parsed = await parseApiSchema(schema, mergeInput({ params, source }));
  if (!parsed.success) {
    throw parsed.error;
  }
  return parsed.data;
}

async function readJsonObject(context: Context): Promise<Record<string, unknown>> {
  const text = await context.req.text();
  if (text.trim() === "") {
    return {};
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw inputError("invalid_json", "Request body must be valid JSON");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw inputError("invalid_type", "Request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function mergeInput({
  params,
  source,
}: {
  params: unknown;
  source: Record<string, unknown>;
}): Record<string, unknown> {
  if (params === void 0) {
    return source;
  }
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    throw inputError("invalid_type", "Path parameters must be an object");
  }
  return { ...source, ...params };
}

function inputError(code: string, message: string): Error {
  return createApiSchemaError([{ code, message, path: [] }]);
}
