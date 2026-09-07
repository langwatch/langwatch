import type { AuthzPermission } from "@langwatch/authz-contract";
import type { MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { parseApiSchemaSync, type ApiSchema } from "../schema.ts";
import type { ApiHandlerArguments } from "../handler-arguments.ts";

import type {
  EndpointDef,
  EndpointDocs,
  EndpointIdempotency,
  HttpMethod,
  RawEndpointDef,
} from "./types.ts";
import { VERSION_LATEST, VERSION_PREVIEW } from "./types.ts";

declare const inputDeclared: unique symbol;
declare const outputDeclared: unique symbol;
declare const paramsDeclared: unique symbol;

/** @internal Type-state marker produced only by `.withInput(...)`. */
export type InputDeclared = { readonly [inputDeclared]: true };
/** @internal Type-state marker produced only by `.withOutput(...)`. */
export type OutputDeclared = { readonly [outputDeclared]: true };
/** @internal Type-state marker produced only by `.withParams(...)`. */
export type ParamsDeclared = { readonly [paramsDeclared]: true };

// The definition chain (ADR 001 §3): the only extension point. Three facades
// share one implementation, gated by which methods each interface exposes.

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
  /**
   * Make this create replayable under `Idempotency-Key`: the framework reads
   * and validates the key, dispatches through the process's receipt ledger,
   * marks a replayed answer, and documents both. Requires the `idempotency`
   * port on the service.
   */
  withIdempotency(idempotency: EndpointIdempotency): this;
  /** Response headers set on every answer this endpoint gives. */
  withHeaders(headers: Readonly<Record<string, string>>): this;
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
  /**
   * Hands the handler the raw body as `input.body`, for surfaces whose body
   * IS the evidence (a webhook signature, a protobuf payload).
   */
  withRawBody(as: "bytes" | "text", options?: { contentType?: string }): this & InputDeclared;
  /**
   * Answer outside the JSON contract: the handler returns a string, bytes, a
   * stream or a whole Response, written with the declared content type.
   * `reason` records why, the way withoutPermission does.
   */
  withRawResponse(reason: string, options?: { contentType?: string }): this & OutputDeclared;
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

/**
 * Input/output are NOT required — declaring neither is complete for an
 * endpoint taking and answering nothing. Access policy, rate limit and
 * resource limit are mandatory, each with a justified opt-out.
 */
type RestReady<
  TPermission extends boolean,
  TRateLimit extends boolean,
  TResourceLimit extends boolean,
> = TPermission extends true
  ? TRateLimit extends true
    ? TResourceLimit extends true
      ? true
      : false
    : false
  : false;

/**
 * True when input declares no scope id, or `.withPermission()` bound one
 * explicitly. An endpoint naming a `projectId` with no scoped permission is
 * the cross-tenant case — it does not compile.
 */
type ScopeBound<TInput extends z.ZodObject | undefined, TScopeBound extends boolean> = [
  ScopeIdsIn<TInput>,
] extends [never]
  ? true
  : TScopeBound;

/**
 * No declared output means returning a value is a compile error, not a
 * value silently dropped before serialization.
 */
export type RestHandlerResult<TOutput extends z.ZodType | undefined> = TOutput extends z.ZodType
  ? z.input<TOutput> | Promise<z.input<TOutput>>
  : void | Promise<void>;

/**
 * A handler gets input only when input was declared, so it can't read
 * something that was never validated.
 */
export type RestEndpointHandler<
  TApp,
  TInput extends z.ZodObject | undefined,
  TOutput extends z.ZodType | undefined,
> = TInput extends z.ZodObject
  ? (args: ApiHandlerArguments<z.output<TInput>, TApp>) => RestHandlerResult<TOutput>
  : (args: ApiHandlerArguments<undefined, TApp>) => RestHandlerResult<TOutput>;

/**
 * A REQUEST-named scope, not necessarily the CREDENTIAL's scope. Unchecked,
 * a caller reads another tenant's data with a permission they genuinely hold.
 */
export type ScopeIdKey = "projectId" | "teamId" | "organizationId" | "userId";

/** The scope ids an endpoint's own input schema declares, if any. */
export type ScopeIdsIn<TInput extends z.ZodObject | undefined> = TInput extends z.ZodObject
  ? Extract<keyof TInput["shape"], ScopeIdKey>
  : never;

/**
 * How an endpoint's permission is anchored.
 *
 * `scope` names the input field the check reads, and it must be a field the
 * input schema actually declares — a typo is a compile error rather than a
 * silently unchecked id. Omitting it is legal only when the input names no
 * scope at all, in which case the credential's own scope is the answer.
 */
export type PermissionScope<TInput extends z.ZodObject | undefined> = {
  scope: ScopeIdsIn<TInput>;
};

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
  TScopeBound extends boolean = false,
> extends RestEndpointDefaults {
  /** Complete path-plus-query/body input schema. */
  withInput<TSchema extends z.ZodObject>(
    schema: TSchema,
  ): RestEndpoint<
    TApp,
    TSchema,
    TOutput,
    TPermission,
    TRateLimit,
    TResourceLimit,
    THandled,
    TScopeBound
  >;
  /** Response body schema, validated before serialization. */
  withOutput<TSchema extends z.ZodType>(
    schema: TSchema,
  ): RestEndpoint<
    TApp,
    TInput,
    TSchema,
    TPermission,
    TRateLimit,
    TResourceLimit,
    THandled,
    TScopeBound
  >;
  /** HTTP status code for successful responses (default: 200, or 204 with no body). */
  withStatus(status: ContentfulStatusCode): this;
  /**
   * When input names a tenant scope, the second argument is REQUIRED and
   * must name that field. No scope in the input means the one-argument form,
   * checked against the credential.
   */
  withPermission(
    permission: AuthzPermission,
    ...anchor: [ScopeIdsIn<TInput>] extends [never] ? [] : [scope: PermissionScope<TInput>]
  ): RestEndpoint<TApp, TInput, TOutput, true, TRateLimit, TResourceLimit, THandled, true>;
  /**
   * Anchors an INHERITED (service-default) permission to this endpoint's
   * own scope, since it never calls `.withPermission()` itself.
   */
  withPermissionScope(
    scope: ScopeIdsIn<TInput>,
  ): RestEndpoint<TApp, TInput, TOutput, TPermission, TRateLimit, TResourceLimit, THandled, true>;
  withoutPermission(
    reason: string,
  ): RestEndpoint<TApp, TInput, TOutput, true, TRateLimit, TResourceLimit, THandled, true>;
  withRateLimit(): RestEndpoint<
    TApp,
    TInput,
    TOutput,
    TPermission,
    true,
    TResourceLimit,
    THandled,
    TScopeBound
  >;
  withoutRateLimit(
    reason: string,
  ): RestEndpoint<TApp, TInput, TOutput, TPermission, true, TResourceLimit, THandled, TScopeBound>;
  withResourceLimit(
    limitType: string,
  ): RestEndpoint<TApp, TInput, TOutput, TPermission, TRateLimit, true, THandled, TScopeBound>;
  withoutResourceLimit(
    reason: string,
  ): RestEndpoint<TApp, TInput, TOutput, TPermission, TRateLimit, true, THandled, TScopeBound>;
  handle(
    this: RestReady<TPermission, TRateLimit, TResourceLimit> extends true
      ? ScopeBound<TInput, TScopeBound> extends true
        ? THandled extends false
          ? RestEndpoint<
              TApp,
              TInput,
              TOutput,
              TPermission,
              TRateLimit,
              TResourceLimit,
              THandled,
              TScopeBound
            >
          : never
        : never
      : never,
    handler: RestEndpointHandler<TApp, TInput, TOutput>,
  ): RestEndpoint<
    TApp,
    TInput,
    TOutput,
    TPermission,
    TRateLimit,
    TResourceLimit,
    true,
    TScopeBound
  >;
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

  withPermission(permission: AuthzPermission, anchor?: { scope: string }): this {
    this._def.permission = permission;
    if (anchor) {
      this._def.permissionScope = anchor.scope;
    } else {
      delete this._def.permissionScope;
    }
    delete this._def.noPermission;
    return this;
  }

  withPermissionScope(scope: string): this {
    this._def.permissionScope = scope;
    return this;
  }

  withoutPermission(reason: string): this {
    this._def.noPermission = { reason };
    delete this._def.permission;
    delete this._def.permissionScope;
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

  withIdempotency(idempotency: EndpointIdempotency): this {
    this._def.idempotency = idempotency;
    return this;
  }

  withRawBody(as: "bytes" | "text", options: { contentType?: string } = {}): this & InputDeclared {
    this._def.rawBody = {
      as,
      ...(options.contentType ? { contentType: options.contentType } : {}),
    };
    return this as this & InputDeclared;
  }

  withRawResponse(reason: string, options: { contentType?: string } = {}): this & OutputDeclared {
    if (reason.trim() === "") {
      throw new Error("withRawResponse requires a written reason");
    }
    this._def.rawResponse = {
      reason,
      ...(options.contentType ? { contentType: options.contentType } : {}),
    };
    return this as this & OutputDeclared;
  }

  withHeaders(headers: Readonly<Record<string, string>>): this {
    this._def.headers = { ...this._def.headers, ...headers };
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
 * A re-declaration closer to the endpoint wins; middleware stacks service,
 * group, endpoint; opt-outs are resolved here.
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

/** A REST route path starts with "/" and cannot squat on the version namespace. */
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

/** An SSE stream is named, not pathed: dotted lower-camelCase, at least one dot. */
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
  if ((method === "get" || method === "head") && def.input) {
    throw new Error(
      `REST endpoint ${method.toUpperCase()} ${path || "/"} cannot declare a JSON body; ` +
        `use path or query input`,
    );
  }
  if (routeHasParams(path) && !def.params) {
    throw new Error(
      `REST endpoint ${method.toUpperCase()} ${path} contains path parameters but ` +
        `does not declare withParams`,
    );
  }
  if (!def.output && !def.rawResponse) {
    throw new Error(
      `REST endpoint ${method.toUpperCase()} ${path || "/"} must declare an output ` +
        `schema; use z.void() for an endpoint with no response body, or ` +
        `withRawResponse(reason) for one that answers outside the JSON contract`,
    );
  }
  if (def.output && def.rawResponse) {
    throw new Error(
      `REST endpoint ${method.toUpperCase()} ${path || "/"} declares both an output ` +
        `schema and a raw response; an answer is validated or it is written through, not both`,
    );
  }
  if (def.rawBody && def.input) {
    throw new Error(
      `REST endpoint ${method.toUpperCase()} ${path || "/"} declares both a raw body ` +
        `and a parsed input; the body is read once`,
    );
  }
  if ((method === "get" || method === "head") && def.rawBody) {
    throw new Error(
      `REST endpoint ${method.toUpperCase()} ${path || "/"} cannot declare a request body`,
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
 * An endpoint answers ONE success status, fixed here rather than per
 * request. An `output` schema that accepts `undefined` alongside a value
 * would let the status depend on what the handler returned, so it's refused
 * at registration.
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
  // Accepts `undefined` but parses it into a value (`.default()`, `.catch()`)
  // — the status still can't move, since it never produces `undefined` here.
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
 * Reads zod's internal type tag rather than probing sample values, which
 * can't tell `z.undefined()` from an optional object schema — both reject
 * every probe.
 */
export function isNoBodySchema(output: ApiSchema): boolean {
  const def = (output as { _def?: { type?: string } })._def;

  return def?.type === "undefined" || def?.type === "void";
}
