import type { AuthzPermission } from "@langwatch/authz-contract";
import type { MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { parseApiSchemaSync, type ApiSchema } from "./schema.js";

import type {
  EndpointDef,
  EndpointDocs,
  HttpMethod,
  RawEndpointDef,
} from "./types.js";
import { VERSION_LATEST, VERSION_PREVIEW } from "./types.js";

// ---------------------------------------------------------------------------
// The definition chain (ADR 001 §3)
//
// The chain is the only extension point: a new capability is a new chain call
// and never changes the `register` signature. Four facades share one
// implementation — the facade an author sees depends on the registration
// method, so an RPC chain does not offer `withParams` and an SSE chain does
// not offer `withInput`. The asserts in the builder re-check the same rules at
// registration for callers the types cannot reach.
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

/** The definition chain of an RPC endpoint: every argument travels in the body. */
export interface RpcChain extends DefaultsChain {
  /** JSON body schema — every argument of the RPC. */
  withInput(schema: ApiSchema): this;
  /** Response body schema — validated before serialization. */
  withOutput(schema: ApiSchema): this;
  /** HTTP status code for successful responses (default: 200, or 204 with no body). */
  withStatus(status: ContentfulStatusCode): this;
}

/** The definition chain of a REST route registered with `registerRoute`. */
export interface RouteChain extends DefaultsChain {
  /** JSON body schema. */
  withInput(schema: ApiSchema): this;
  /** Response body schema — validated before serialization. */
  withOutput(schema: ApiSchema): this;
  /** HTTP status code for successful responses (default: 200, or 204 with no body). */
  withStatus(status: ContentfulStatusCode): this;
  /** Path parameter schema; validated values are read via `c.get("params")`. */
  withParams(schema: ApiSchema): this;
  /** Query string schema; validated values are read via `c.get("query")`. */
  withQuery(schema: ApiSchema): this;
}

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

  withoutRateLimit(): this {
    this._def.rateLimit = false;
    return this;
  }

  withInput(schema: ApiSchema): this {
    this._def.input = schema;
    return this;
  }

  withOutput(schema: ApiSchema): this {
    this._def.output = schema;
    return this;
  }

  withStatus(status: ContentfulStatusCode): this {
    this._def.status = status;
    return this;
  }

  withParams(schema: ApiSchema): this {
    this._def.params = schema;
    return this;
  }

  withQuery(schema: ApiSchema): this {
    this._def.query = schema;
    return this;
  }

  withEvents(events: Record<string, ApiSchema>): this {
    this._def.events = events;
    return this;
  }
}

/** Runs a `define` callback over a fresh chain, tolerating its absence. */
export function collectDef(
  define: ((b: ChainBuilder) => unknown) | undefined,
): RawEndpointDef {
  if (!define) return {};
  const builder = new ChainBuilder();
  define(builder);
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
 * RPC and SSE names never reach this assert — their grammar is checked by
 * `assertRpcName` on the full dotted name.
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
    throw new Error(
      `Endpoint path "${path}" collides with the reserved API version namespace`,
    );
  }
}

/**
 * The pipeline installs a validator for whichever of `params` / `query` a
 * definition declares, so "every argument travels in the body" holds only while
 * an RPC declares neither. Rejecting here makes the sentence enforceable rather
 * than aspirational: a dotted name has no `:param` to bind, and a query string
 * would smuggle arguments back into the URL that the operation name owns.
 */
export function assertRpcDef({
  name,
  def,
}: {
  name: string;
  def: RawEndpointDef;
}): void {
  const offending = (["params", "query"] as const).filter(
    (key) => def[key] !== undefined,
  );

  if (offending.length > 0) {
    throw new Error(
      `RPC endpoint "${name}" declares ${offending.join(" and ")}; RPC ` +
        `arguments travel in the JSON body, so use "input" instead`,
    );
  }
}

/** A stream has no request body and no path params; request data is query only. */
export function assertSseDef({
  name,
  def,
}: {
  name: string;
  def: RawEndpointDef;
}): void {
  const offending = (["input", "params"] as const).filter(
    (key) => def[key] !== undefined,
  );

  if (offending.length > 0) {
    throw new Error(
      `SSE endpoint "${name}" declares ${offending.join(" and ")}; a stream ` +
        `has no request body and no path params, so use "query" instead`,
    );
  }
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
 * `status ?? 200`; declare `z.void()` and always answer `status ?? 204`; or
 * declare no `output` at all, where the handler builds its own `Response` and
 * that response owns its status outright. This rule governs value-returning
 * handlers — a hand-built `Response` is the framework's deliberate opt-out and
 * always has been.
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
 * BOTH ZOD MAJORS, because they name the tag differently and the failure is
 * silent. v3 carries `_def.typeName: "ZodVoid"`; v4 carries `_def.type: "void"`
 * and no `typeName` at all. Reading only v3's spelling meant a v4 `z.void()`
 * output was not recognised as no-body, fell through to the ambiguity check,
 * accepted `undefined` and parsed it to `undefined` — and was refused at
 * registration. The service would fail to build, and the message would talk
 * about a schema accepting undefined as well as a value, which is not what
 * happened and sends the reader somewhere else entirely.
 *
 * New feature contracts author Zod 4 schemas while legacy app routes still
 * use Zod 3. `status-invariant.unit.test.ts` pins both spellings, so a future
 * Zod change fails there rather than reclassifying every no-body endpoint.
 */
export function isNoBodySchema(output: ApiSchema): boolean {
  const def = (output as { _def?: { typeName?: string; type?: string } })
    ._def as { typeName?: string; type?: string } | undefined;

  return (
    def?.typeName === "ZodUndefined" ||
    def?.typeName === "ZodVoid" ||
    def?.type === "undefined" ||
    def?.type === "void"
  );
}
