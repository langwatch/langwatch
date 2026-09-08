/**
 * What the published document says about a route: the operation block one
 * declared route generates, the security requirement its credential class
 * publishes, the 3.1 spelling of an exclusive bound, a hand-written operation,
 * the deprecation headers a superseded family answers with, and the external
 * URL a caller is linked to.
 */
import type { MiddlewareHandler } from "hono";
import { describeRoute, resolver, type DescribeRouteOptions } from "hono-openapi";

import type { CredentialClass } from "../access-policy.ts";
import type { EndpointDocs } from "./response.ts";
import type { RestTransportRoute } from "./runtime.ts";

// ─────────────────────────────────────────────────────────────────────────────
// What a declared REST route publishes: its operation id and the answer the
// declaration named.
//
// Parameters and the request body are NOT written here: hono-openapi's own
// validators already carry that metadata, and the document is generated from
// the mounted app.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The operation id one mount publishes. Every version mount needs a distinct
 * id because OpenAPI requires it to be unique across the whole document, so
 * the declared name belongs to whichever mount a client is told to call — the
 * bare alias — and every other mount suffixes the version it serves.
 */
export function operationIdOf({
  operation,
  suffix,
}: {
  operation: string;
  suffix?: string | undefined;
}): string {
  return suffix ? `${operation}_${suffix}` : operation;
}

/** The OpenAPI block one declared route publishes at one of its mounts. */
export function restRouteDocumentation({
  route,
  suffix,
}: {
  route: RestTransportRoute<unknown>;
  suffix?: string | undefined;
}): DescribeRouteOptions {
  const status = String(route.status ?? 200);

  const options: DescribeRouteOptions = {
    responses: {
      [status]: {
        description: "Success",
        content: { "application/json": { schema: resolver(route.output) } },
      },
    },
    operationId: operationIdOf({ operation: route.operation, suffix }),
  };

  if (route.docs?.description !== undefined) options.description = route.docs.description;

  if (route.docs?.summary !== undefined) options.summary = route.docs.summary;

  return options;
}

/** The same block, as the middleware that attaches it to a mounted route. */
export function documentRoute(input: {
  route: RestTransportRoute<unknown>;
  suffix?: string | undefined;
}): MiddlewareHandler {
  return describeRoute(restRouteDocumentation(input));
}

// ─────────────────────────────────────────────────────────────────────────────
// The security requirement a documented operation publishes.
// ─────────────────────────────────────────────────────────────────────────────

/** An OpenAPI security requirement: scheme name to the scopes it needs. */
export type SecurityRequirement = Record<string, never[]>;

/**
 * The fixed set of Path Item members that are operations, per OpenAPI 3.1.
 * A Path Item also holds `servers`, `parameters`, `summary`, `description`
 * and `$ref` — the first two are arrays, which are objects to `typeof` —
 * so walking by value shape mistakes them for operations and stamps
 * `security` onto `servers`, producing a document that no longer validates.
 */
const HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

/** Whether a Path Item member names an operation rather than path metadata. */
export function isHttpMethod(member: string): boolean {
  return HTTP_METHODS.has(member.toLowerCase());
}

/**
 * A registered route's path, spelled the way the OpenAPI document spells
 * it. Hono writes `:id` where the document writes `{id}` and may pin it to
 * a matcher pattern (`/:id{.+}`); carrying that through produced an
 * undocumented path that kept the document-wide security default instead
 * of the route's real credential class. The inner alternation allows one
 * level of nesting so a quantifier (`{[0-9]{3}}`) is consumed whole.
 */
export function documentedPathOf(honoPath: string): string {
  return honoPath.replace(/:([A-Za-z0-9_]+)(\{(?:[^{}]|\{[^{}]*\})*\})?/g, "{$1}");
}

/**
 * Which security schemes the published document offers for each credential
 * class. Only classes an API consumer can actually present appear; the
 * omission is the point, since an empty requirement list means "no
 * credential required", which is true of a public route and false of a
 * session-only or internal one — those two are refused, not published.
 */
const SECURITY_BY_CREDENTIAL_CLASS = {
  project_api_key: [{ project_api_key: [] }],
  organization_api_key: [{ admin_api_key: [] }],
  instance_admin_api_key: [{ instance_admin_key: [] }],
  scim_token: [{ scim_bearer: [] }],
  none: [],
} as const satisfies Record<
  Exclude<CredentialClass, "session" | "internal">,
  readonly SecurityRequirement[]
>;

/**
 * The security requirement a documented operation publishes, given the
 * credential class its route enforces. Throws when the class is one an API
 * client cannot present (session cookie, internal shared secret) — writing
 * an empty requirement instead would make every generated client emit an
 * unauthenticated call, so this fails the generator rather than shipping.
 * @param operationKey `"GET /api/gateway/v1/budgets"`, for the message.
 */
export function securityForCredentialClass({
  operationKey,
  credentialClass,
}: {
  operationKey: string;
  credentialClass: CredentialClass;
}): readonly SecurityRequirement[] {
  if (credentialClass === "session" || credentialClass === "internal") {
    throw new Error(
      `${operationKey} is documented in the public API description but reaches by "${credentialClass}", ` +
        "which has no security scheme an API client can satisfy. Either give the document a scheme " +
        "for it, or drop the describeRoute() so it stops being advertised.",
    );
  }
  return SECURITY_BY_CREDENTIAL_CLASS[credentialClass];
}

// ─────────────────────────────────────────────────────────────────────────────
// The 3.1 spelling of an exclusive bound.
//
// The document declares `openapi: 3.1.0`, where a schema is JSON Schema
// 2020-12 and `exclusiveMinimum` / `exclusiveMaximum` are numbers. The schema
// builders still emit the OpenAPI 3.0 spelling: a boolean flag next to a
// `minimum` or `maximum`. Strict validators reject it, and a client generator
// reading it either drops the bound or errors, so a `z.number().int().positive()`
// reached integrators as an unbounded integer.
// ─────────────────────────────────────────────────────────────────────────────

/** Whether the value is a plain object worth walking into. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Rewrite every `exclusiveMinimum: true` / `exclusiveMaximum: true` into the
 * numeric 3.1 form, in place.
 *
 * `{ minimum: 0, exclusiveMinimum: true }` becomes `{ exclusiveMinimum: 0 }`.
 * A boolean flag with no bound beside it says nothing and is dropped; `false`
 * means "inclusive", which is what a bare `minimum` already says.
 */
export function normalizeExclusiveBounds<T>(document: T): T {
  walk(document);
  return document;
}

function walk(node: unknown): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child);
    return;
  }
  if (!isRecord(node)) return;

  normalizeBound({ node, flag: "exclusiveMinimum", bound: "minimum" });
  normalizeBound({ node, flag: "exclusiveMaximum", bound: "maximum" });

  for (const child of Object.values(node)) walk(child);
}

function normalizeBound({
  node,
  flag,
  bound,
}: {
  node: Record<string, unknown>;
  flag: "exclusiveMinimum" | "exclusiveMaximum";
  bound: "minimum" | "maximum";
}): void {
  const value = node[flag];
  if (typeof value !== "boolean") return;

  const limit = node[bound];
  if (value && typeof limit === "number") {
    node[flag] = limit;
    delete node[bound];
    return;
  }
  delete node[flag];
}

// ─────────────────────────────────────────────────────────────────────────────
// A hand-written operation, for a family that documents what it parses itself.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `security` and path `parameters` are framework-derived, so they are dropped
 * here rather than restated. Everything else a person wrote carries through
 * unchanged, including the request body, since a family parsing its own body
 * gives the framework no schema to derive one from.
 */
export function handWrittenDocs(spec: DescribeRouteOptions): EndpointDocs {
  return {
    ...(spec.summary === undefined ? {} : { summary: spec.summary }),
    ...(typeof spec.description === "string" ? { description: spec.description } : {}),
    ...(spec.tags ? { tags: [...spec.tags] } : {}),
    ...(typeof spec.operationId === "string" ? { operationId: spec.operationId } : {}),
    ...(spec.responses ? { responses: spec.responses } : {}),
    ...(spec.requestBody ? { requestBody: spec.requestBody } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Marking a whole route family as a deprecated alias.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sets `Deprecation: true` and a `successor-version` link on every response of
 * the family it is applied to.
 */
export function deprecatedAlias({
  successor,
  notice,
}: {
  /** The path of the family that replaces this one. */
  successor: string;
  notice?: string;
}): MiddlewareHandler {
  return async (c, next) => {
    // Prepared before the handler runs, so a refusal the family THROWS carries
    // them too: a header written after `next()` is never reached once the
    // error is on its way to the boundary.
    c.header("Deprecation", "true");
    c.header("Link", `<${successor}>; rel="successor-version"`);
    if (notice) c.header("X-API-Deprecation-Notice", notice);
    await next();
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The external URL of a resource in the LangWatch UI.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A port rather than a function: the origin comes from the running
 * deployment's validated environment, which a transport package has no access
 * to and must not read for itself.
 */
export type PlatformUrlBuilder = (args: { projectSlug: string; path: string }) => string;
