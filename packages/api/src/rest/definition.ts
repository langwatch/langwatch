import type { AuthzPermission } from "@langwatch/authz-contract";
import type { MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { parseApiSchemaSync, type ApiSchema } from "../schema.js";

import type {
  EndpointDef,
  EndpointDocs,
  HttpMethod,
  RawEndpointDef,
  ServiceContext,
} from "./types.js";
import { VERSION_LATEST, VERSION_PREVIEW } from "./types.js";

declare const inputDeclared: unique symbol;
declare const outputDeclared: unique symbol;
declare const paramsDeclared: unique symbol;

/** @internal Type-state marker produced only by `.withInput(...)`. */
export type InputDeclared = { readonly [inputDeclared]: true };
/** @internal Type-state marker produced only by `.withOutput(...)`. */
export type OutputDeclared = { readonly [outputDeclared]: true };
/** @internal Type-state marker produced only by `.withParams(...)`. */
export type ParamsDeclared = { readonly [paramsDeclared]: true };

// ---------------------------------------------------------------------------
// The definition chain (ADR 001 §3)
//
// The chain is the only extension point: a new capability is a new chain call
// and never changes a registration signature. Three facades share one
// implementation — the facade an author sees depends on the registration
// method, so an SSE chain does not offer `withInput` and a public REST chain
// does not offer `withParams`. The asserts in the builder re-check the same
// rules at registration for callers the types cannot reach.
// ---------------------------------------------------------------------------

/** Chain calls that can also be declared as service or group defaults. */
export interface DefaultsChain {
  /** OpenAPI documentation: summary, description, operationId, tags, responses. */
  withDocs(docs: EndpointDocs): this;
  /** Auth override for the endpoint; `"none"` skips authentication entirely. */
  withAuth(auth: "default" | "none" | MiddlewareHandler): this;
  /** Declare the permission the framework must enforce for this endpoint. */
  withPermission(permission: AuthzPermission): this;
  /** Deliberately opt out of permission enforcement with a written reason. */
  withoutPermission(reason: string): this;
  /** Resource limit type — requires `_legacy.resourceLimitMiddleware` on the service. */
  withResourceLimit(limitType: string): this;
  /** Deliberately opt out of a resource limit with a written reason. */
  withoutResourceLimit(reason: string): this;
  /** Middleware running after auth and before the handler; stacks across levels. */
  withMiddleware(...middleware: MiddlewareHandler[]): this;
  /** Opaque metadata for the mount report; never read by the framework. */
  withMeta(meta: unknown): this;
  /** Rate-limit this endpoint; requires the `rateLimiter` port. */
  withRateLimit(): this;
  /** Cache validated responses under `tag`; requires the `cache` port and an output. */
  withCache(tag: string, ttlSeconds: number): this;
  /** Mark the endpoint deprecated: documented as such, warns on every response. */
  withDeprecated(notice: string): this;
  /** Opt out of a service- or group-level `withCache` default. */
  withoutCache(): this;
  /** Opt out of a service- or group-level `withRateLimit` default. */
  withoutRateLimit(): this;
}

/** The definition chain of an HTTP route registered with `registerRoute`. */
export interface RouteChain extends DefaultsChain {
  /** JSON body schema. */
  withInput(schema: ApiSchema): this & InputDeclared;
  /** Response body schema — validated before serialization. */
  withOutput(schema: ApiSchema): this & OutputDeclared;
  /** HTTP status code for successful responses (default: 200, or 204 with no body). */
  withStatus(status: ContentfulStatusCode): this;
  /** Path parameter schema; parsed fields are merged into the handler input. */
  withParams(schema: ApiSchema): this & InputDeclared & ParamsDeclared;
  /** Query string schema; parsed fields are merged into the handler input. */
  withQuery(schema: ApiSchema): this & InputDeclared;
}

/**
 * The public REST chain. One object schema describes the complete request;
 * the HTTP method decides whether non-path fields come from query or JSON.
 */
/** OpenAPI fields REST authors may set per endpoint. Authentication comes from the service. */
export type RestEndpointDocs = Omit<EndpointDocs, "security">;

/** Endpoint capabilities available to modern REST routes. */
export interface RestEndpointDefaults extends Omit<
  DefaultsChain,
  | "withAuth"
  | "withDocs"
  | "withPermission"
  | "withoutPermission"
  | "withRateLimit"
  | "withoutRateLimit"
  | "withResourceLimit"
  | "withoutResourceLimit"
> {
  /** OpenAPI documentation except security, which is derived from service authentication. */
  withDocs(docs: RestEndpointDocs): this;
}

type RestReady<
  TInput extends z.ZodObject | undefined,
  TOutput extends z.ZodType | undefined,
  TPermission extends boolean,
  TRateLimit extends boolean,
  TResourceLimit extends boolean,
> = TInput extends z.ZodObject
  ? TOutput extends z.ZodType
    ? TPermission extends true
      ? TRateLimit extends true
        ? TResourceLimit extends true
          ? true
          : false
        : false
      : false
    : false
  : false;

export type RestEndpointHandler<TApp, TInput extends z.ZodObject, TOutput extends z.ZodType> = (
  context: ServiceContext<Record<string, unknown>, TApp>,
  input: z.output<TInput>,
) => z.input<TOutput> | Promise<z.input<TOutput>>;

/**
 * The modern REST definition chain. Input and output schemas carry their
 * static types through the schema-first registration callback.
 */
export interface RestEndpoint<
  TApp = unknown,
  TInput extends z.ZodObject | undefined = undefined,
  TOutput extends z.ZodType | undefined = undefined,
  TPermission extends boolean = false,
  TRateLimit extends boolean = false,
  TResourceLimit extends boolean = false,
  THandled extends boolean = false,
> extends RestEndpointDefaults {
  /** Complete path-plus-query/body input schema. */
  withInput<TSchema extends z.ZodObject>(
    schema: TSchema,
  ): RestEndpoint<TApp, TSchema, TOutput, TPermission, TRateLimit, TResourceLimit, THandled>;
  /** Response body schema, validated before serialization. */
  withOutput<TSchema extends z.ZodType>(
    schema: TSchema,
  ): RestEndpoint<TApp, TInput, TSchema, TPermission, TRateLimit, TResourceLimit, THandled>;
  /** HTTP status code for successful responses (default: 200, or 204 with no body). */
  withStatus(status: ContentfulStatusCode): this;
  withPermission(
    permission: AuthzPermission,
  ): RestEndpoint<TApp, TInput, TOutput, true, TRateLimit, TResourceLimit, THandled>;
  withoutPermission(
    reason: string,
  ): RestEndpoint<TApp, TInput, TOutput, true, TRateLimit, TResourceLimit, THandled>;
  withRateLimit(): RestEndpoint<TApp, TInput, TOutput, TPermission, true, TResourceLimit, THandled>;
  withoutRateLimit(
    reason: string,
  ): RestEndpoint<TApp, TInput, TOutput, TPermission, true, TResourceLimit, THandled>;
  withResourceLimit(
    limitType: string,
  ): RestEndpoint<TApp, TInput, TOutput, TPermission, TRateLimit, true, THandled>;
  withoutResourceLimit(
    reason: string,
  ): RestEndpoint<TApp, TInput, TOutput, TPermission, TRateLimit, true, THandled>;
  handle(
    this: RestReady<TInput, TOutput, TPermission, TRateLimit, TResourceLimit> extends true
      ? THandled extends false
        ? RestEndpoint<TApp, TInput, TOutput, TPermission, TRateLimit, TResourceLimit, THandled>
        : never
      : never,
    handler: RestEndpointHandler<TApp, Extract<TInput, z.ZodObject>, Extract<TOutput, z.ZodType>>,
  ): RestEndpoint<TApp, TInput, TOutput, TPermission, TRateLimit, TResourceLimit, true>;
}

/** @deprecated Use RestEndpoint for modern REST definitions. */
export type RestChain = RestEndpoint;

/**
 * The definition chain of an SSE endpoint. A stream has no request body and no
 * path params, so `withInput` and `withParams` are not offered; request data
 * arrives through `withQuery` only.
 */
export interface SseChain extends DefaultsChain {
  /** Query string schema; validated values are read via `c.get("query")`. */
  withQuery(schema: ApiSchema): this;
  /** Declares the stream's events: event name to payload schema. */
  withEvents(events: Record<string, ApiSchema>): this;
}

/**
 * The one chain implementation behind every facade. The facades are type-only
 * views; runtime asserts at registration are what hold the rules for callers
 * that reach the implementation behind an `any`.
 *
 * @internal
 */
export class ChainBuilder {
  /** @internal */
  readonly _def: RawEndpointDef = {};

  withDocs(docs: EndpointDocs): this {
    this._def.docs = { ...this._def.docs, ...docs };
    return this;
  }

  withAuth(auth: "default" | "none" | MiddlewareHandler): this {
    this._def.auth = auth;
    return this;
  }

  withPermission(permission: AuthzPermission): this {
    this._def.permission = permission;
    delete this._def.noPermission;
    return this;
  }

  withoutPermission(reason: string): this {
    this._def.noPermission = { reason };
    delete this._def.permission;
    return this;
  }

  withResourceLimit(limitType: string): this {
    this._def.resourceLimit = limitType;
    delete this._def.resourceLimitOptOutReason;
    return this;
  }

  withoutResourceLimit(reason: string): this {
    this._def.resourceLimit = false;
    this._def.resourceLimitOptOutReason = reason;
    return this;
  }

  withMiddleware(...middleware: MiddlewareHandler[]): this {
    this._def.middleware = [...(this._def.middleware ?? []), ...middleware];
    return this;
  }

  withMeta(meta: unknown): this {
    this._def.meta = meta;
    return this;
  }

  withRateLimit(): this {
    this._def.rateLimit = true;
    delete this._def.rateLimitOptOutReason;
    return this;
  }

  withCache(tag: string, ttlSeconds: number): this {
    this._def.cache = { tag, ttlSeconds };
    return this;
  }

  withDeprecated(notice: string): this {
    this._def.deprecated = notice;
    return this;
  }

  withoutCache(): this {
    this._def.cache = false;
    return this;
  }

  withoutRateLimit(reason = ""): this {
    this._def.rateLimit = false;
    this._def.rateLimitOptOutReason = reason;
    return this;
  }

  withInput(schema: ApiSchema): this & InputDeclared {
    this._def.input = schema;
    return this as this & InputDeclared;
  }

  withOutput(schema: ApiSchema): this & OutputDeclared {
    this._def.output = schema;
    return this as this & OutputDeclared;
  }

  withStatus(status: ContentfulStatusCode): this {
    this._def.status = status;
    return this;
  }

  withParams(schema: ApiSchema): this & InputDeclared & ParamsDeclared {
    this._def.params = schema;
    return this as this & InputDeclared & ParamsDeclared;
  }

  withQuery(schema: ApiSchema): this & InputDeclared {
    this._def.query = schema;
    return this as this & InputDeclared;
  }

  withEvents(events: Record<string, ApiSchema>): this {
    this._def.events = events;
    return this;
  }
}

/** Runs a `define` callback over a fresh chain, tolerating its absence. */
export function collectDef<TChain = ChainBuilder>(
  define: ((builder: TChain) => unknown) | undefined,
): RawEndpointDef {
  if (!define) return {};
  const builder = new ChainBuilder();
  define(builder as TChain);
  return builder._def;
}

// ---------------------------------------------------------------------------
// Precedence: service < group < endpoint
// ---------------------------------------------------------------------------

/**
 * Merges definition levels into the effective endpoint definition. A
 * re-declaration closer to the endpoint wins; middleware stacks service first,
 * group second, endpoint last; `withoutCache` / `withoutRateLimit` opt-outs are
 * resolved here, so the result only carries capabilities that actually apply.
 */
export function mergeDefs(...levels: RawEndpointDef[]): EndpointDef {
  const middleware: MiddlewareHandler[] = [];
  let docs: EndpointDocs | undefined;
  const merged: RawEndpointDef = {};

  for (const level of levels) {
    const { docs: levelDocs, middleware: levelMiddleware, ...rest } = level;
    if (level.permission !== undefined) delete merged.noPermission;
    if (level.noPermission !== undefined) delete merged.permission;
    Object.assign(merged, rest);
    if (levelDocs) docs = { ...docs, ...levelDocs };
    if (levelMiddleware) middleware.push(...levelMiddleware);
  }

  const resolved: EndpointDef = merged as EndpointDef;
  if (merged.rateLimit === false) delete resolved.rateLimit;
  if (merged.resourceLimit === false) delete resolved.resourceLimit;
  if (merged.cache === false) delete resolved.cache;
  if (docs) resolved.docs = docs;
  if (middleware.length > 0) resolved.middleware = middleware;
  return resolved;
}

// ---------------------------------------------------------------------------
// Registration asserts
// ---------------------------------------------------------------------------

const DATE_VERSION_SEGMENT_RE = /^20\d{2}-\d{2}-\d{2}$/;

/**
 * A REST route path starts with "/" and cannot squat on the version namespace.
 * SSE names never reach this assert — their grammar is checked by
 * `assertSseName` on the full dotted name.
 */
export function assertRoutePath(path: string): void {
  if (path !== "" && !path.startsWith("/")) {
    throw new Error(`Endpoint path must start with "/"; received "${path}"`);
  }

  const firstSegment = path.split("/").find(Boolean);
  if (
    firstSegment === VERSION_LATEST ||
    firstSegment === VERSION_PREVIEW ||
    (firstSegment !== undefined && DATE_VERSION_SEGMENT_RE.test(firstSegment))
  ) {
    throw new Error(`Endpoint path "${path}" collides with the reserved API version namespace`);
  }
}

/**
 * An SSE stream is named, not pathed: dotted lower-camelCase segments, at
 * least one dot, no leading slash and no path parameters. The name becomes the
 * mounted path verbatim, so the grammar is checked here rather than by
 * `assertRoutePath`, which only ever sees a REST path.
 */
const SSE_NAME_RE = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;

export function assertSseName(name: string): void {
  if (!SSE_NAME_RE.test(name)) {
    throw new Error(
      `SSE endpoint name "${name}" must be a dotted <resource>.<verb> name in ` +
        `lower camelCase with no leading slash and no path parameters, ` +
        `e.g. "things.stream"`,
    );
  }
}

/** A stream has no request body and no path params; request data is query only. */
export function assertSseDef({ name, def }: { name: string; def: RawEndpointDef }): void {
  const offending = (["input", "params"] as const).filter((key) => def[key] !== undefined);

  if (offending.length > 0) {
    throw new Error(
      `SSE endpoint "${name}" declares ${offending.join(" and ")}; a stream ` +
        `has no request body and no path params, so use "query" instead`,
    );
  }
}

/** REST routes return framework-validated values, including explicit no-body values. */
export function assertRouteDef({
  method,
  path,
  def,
}: {
  method: HttpMethod;
  path: string;
  def: RawEndpointDef;
}): void {
  if (method === "get" && def.input) {
    throw new Error(
      `REST endpoint GET ${path || "/"} cannot declare a JSON body; use path ` + `or query input`,
    );
  }
  if (routeHasParams(path) && !def.params) {
    throw new Error(
      `REST endpoint ${method.toUpperCase()} ${path} contains path parameters but ` +
        `does not declare withParams`,
    );
  }
  if (!def.output) {
    throw new Error(
      `REST endpoint ${method.toUpperCase()} ${path || "/"} must declare an output ` +
        `schema; use z.void() for an endpoint with no response body`,
    );
  }
}

/** Rules specific to the additive public REST surface. */
export function assertPublicRestDef({
  method,
  path,
  def,
}: {
  method: HttpMethod;
  path: string;
  def: RawEndpointDef;
}): void {
  const explicitSources = (["params", "query"] as const).filter((source) => def[source] !== void 0);
  if (explicitSources.length > 0) {
    throw new Error(
      `Public REST endpoint ${method.toUpperCase()} ${path || "/"} declares ` +
        `${explicitSources.join(" and ")}; declare one withInput object instead`,
    );
  }

  if (!def.output || !(def.output instanceof z.ZodType)) {
    throw new Error(
      `Public REST endpoint ${method.toUpperCase()} ${path || "/"} must declare ` +
        `a Zod 4 output schema; use z.void() for no response body`,
    );
  }

  if (!(def.input instanceof z.ZodObject)) {
    throw new Error(
      `Public REST endpoint ${method.toUpperCase()} ${path || "/"} must declare ` +
        `one Zod 4 object input schema, including z.object({}) when it has no fields`,
    );
  }
  if (def.rateLimit !== true && !def.rateLimitOptOutReason?.trim()) {
    throw new Error(
      `Public REST endpoint ${method.toUpperCase()} ${path || "/"} must declare a rate limit or a nonblank opt-out reason`,
    );
  }
  if (def.resourceLimit === void 0 && !def.resourceLimitOptOutReason?.trim()) {
    throw new Error(
      `Public REST endpoint ${method.toUpperCase()} ${path || "/"} must declare a resource limit or a nonblank opt-out reason`,
    );
  }

  const parameterNames = routeParameterNames(path);
  if (parameterNames.length === 0) {
    return;
  }
  const input = def.input;

  const missing = parameterNames.filter((name) => !(name in input.shape));
  if (missing.length > 0) {
    throw new Error(
      `Public REST endpoint ${method.toUpperCase()} ${path} has path parameters ` +
        `missing from withInput: ${missing.join(", ")}`,
    );
  }
}

function routeHasParams(path: string): boolean {
  return path.split("/").some((segment) => segment.startsWith(":"));
}

export function routeParameterNames(path: string): string[] {
  return path
    .split("/")
    .filter((segment) => segment.startsWith(":"))
    .map((segment) => /^:([^{?]+)/.exec(segment)?.[1])
    .filter((name): name is string => name !== void 0);
}

// ---------------------------------------------------------------------------
// The success-status invariant
// ---------------------------------------------------------------------------

/**
 * An endpoint answers ONE success status, fixed here rather than per request.
 *
 * `serializeEndpointResult` used to read the handler's return value to choose:
 * a declared `output` that parsed `undefined` answered 204 while a value
 * answered 200, so one operation could return either depending on what it
 * found — and callers, the published document and the SDKs all have to pick
 * one. An `output` schema that accepts `undefined` is what makes that
 * reachable, so it is refused at registration.
 *
 * The honest shapes remain: declare a required `output` and always answer
 * `status ?? 200`, or declare `z.void()` and always answer `status ?? 204`.
 * Every route declares an output — `assertRouteDef` refuses one that does
 * not — so neither shape can be opted out of.
 */
export function assertStatusInvariant({
  method,
  path,
  def,
}: {
  method: HttpMethod | "sse";
  path: string;
  def: RawEndpointDef;
}): void {
  // No schema, or one whose only accepted value is `undefined`: the endpoint
  // has no body and always answers 204.
  if (!def.output || isNoBodySchema(def.output)) return;

  const parsed = parseApiSchemaSync(def.output, undefined);
  // A schema that rejects `undefined`: the body is always present and the
  // endpoint always answers 200.
  if (!parsed.success) return;
  // A schema that ACCEPTS `undefined` and parses it into a value —
  // `.default(...)`, `.catch(...)`. The status still cannot move, because
  // `serializeEndpointResult` branches on what the schema produced, not on what
  // it accepted, and it never produces `undefined` here. Testing acceptance
  // instead of the parsed value refused these at registration for a status
  // ambiguity they do not have.
  if (parsed.data !== undefined) return;

  // What is left accepts `undefined` AND a value, and yields `undefined` for
  // it — `.optional()`, `z.any()`, a union with `undefined` in it — which is
  // the only way the status can actually move.
  throw new Error(
    `Endpoint ${method.toUpperCase()} ${path} declares an "output" schema that ` +
      `accepts undefined as well as a value, so its success status would ` +
      `depend on what the handler returned — 204 when undefined, ` +
      `${def.status ?? 200} otherwise. Make the output required, or declare ` +
      `z.void() for an endpoint that never sends a body`,
  );
}

/**
 * True for the schemas whose ONLY accepted value is `undefined`, which declare
 * an endpoint that never sends a body.
 *
 * Read off zod's internal type tag deliberately: probing with sample values
 * cannot tell `z.undefined()` from `z.object({ id: z.string() }).optional()`,
 * since both reject every probe a caller could think to try — `{}` included.
 *
 * Zod 4 exposes the exact type tag as `_def.type`. Reading the tag is necessary
 * because probing cannot distinguish `z.void()` from an optional value schema:
 * both accept `undefined`, but only the former declares a bodyless endpoint.
 */
export function isNoBodySchema(output: ApiSchema): boolean {
  const def = (output as { _def?: { type?: string } })._def;

  return def?.type === "undefined" || def?.type === "void";
}
