/**
 * What the published document says about a route: the operation block one
 * declared route generates, the security requirement its credential class
 * publishes, the 3.1 spelling of an exclusive bound, a hand-written operation,
 * the deprecation headers a superseded family answers with, and the external
 * URL a caller is linked to.
 */
import type { MiddlewareHandler } from "hono";
import { describeRoute, resolver, type DescribeRouteOptions } from "hono-openapi";

import { z, type ZodType } from "zod";

import type { CredentialClass } from "../access-policy.ts";
import { securityRequirement } from "../access/access.ts";
import type { RestDeprecation, RestDoorCredential, RestTransportRoute } from "./declaration.ts";
import type { RestMultipart } from "./request.ts";
import type { EndpointDocs, RouteResponse } from "./response.ts";

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
  deprecated,
  credential,
}: {
  route: RestTransportRoute<unknown>;
  suffix?: string | undefined;
  deprecated?: RestDeprecation | undefined;
  /** The family's door, for the scheme an optional credential publishes. */
  credential?: RestDoorCredential | undefined;
}): DescribeRouteOptions {
  const options: DescribeRouteOptions = {
    responses: { ...declaredAnswers(route), ...route.docs?.responses },
    operationId: operationIdOf({ operation: route.operation, suffix }),
  };

  if (route.docs?.description !== undefined) options.description = route.docs.description;

  if (route.docs?.summary !== undefined) options.summary = route.docs.summary;

  if (route.docs?.tags !== undefined) options.tags = [...route.docs.tags];

  // The body of a route nothing parses: the media type it is sent as, and no
  // schema, because the declaration named none to publish.
  if (route.rawBody) {
    options.requestBody = { required: true, content: { [route.rawBody.mediaType]: {} } };
  }

  // The fields and the file parts a multipart route names. The files publish
  // as binary strings, which is how OpenAPI 3.1 spells an uploaded file.
  if (route.multipart) {
    options.requestBody = {
      required: true,
      content: { "multipart/form-data": { schema: multipartSchema(route.multipart) } },
    };
  }

  // An empty requirement list is the document's way of saying "no credential",
  // which is exactly what a public route is; it also overrides the document's
  // own default requirement, which every other operation inherits. A route the
  // door still authenticates keeps its family's scheme.
  if (route.access?.kind === "public") options.security = [];

  // An optional credential publishes both alternatives: the empty requirement
  // for the caller who presents none, and the family's own scheme beside it.
  if (route.access?.kind === "optional" && credential) {
    options.security = [{}, ...securityRequirement(credential)];
  }

  if (deprecated) {
    options.deprecated = true;
    options.description = [options.description, deprecationNotice(deprecated)]
      .filter((part) => part !== undefined && part !== "")
      .join(" ");
  }

  return options;
}

/** The same block, as the middleware that attaches it to a mounted route. */
export function documentRoute(input: {
  route: RestTransportRoute<unknown>;
  suffix?: string | undefined;
  deprecated?: RestDeprecation | undefined;
  credential?: RestDoorCredential | undefined;
}): MiddlewareHandler {
  return describeRoute(restRouteDocumentation(input));
}

/**
 * The published shape of a multipart body: the fields the route parses, and
 * one binary property per file part it named, required where the declaration
 * said the request must carry it.
 */
function multipartSchema(multipart: RestMultipart): Record<string, unknown> {
  const { $schema: _draft, ...fields } = z.toJSONSchema(multipart.fields, { io: "input" });
  const properties = { ...(fields.properties as Record<string, unknown> | undefined) };
  const required = [...((fields.required as string[] | undefined) ?? [])];

  for (const [name, part] of Object.entries(multipart.files)) {
    properties[name] = { type: "string", format: "binary" };

    if (part.required) required.push(name);
  }

  return { ...fields, type: "object", properties, ...(required.length > 0 ? { required } : {}) };
}

/**
 * Every answer the DECLARATION named: the one success a route declares with
 * `withOutput`, or each status of a route that declared several with
 * `responds`. Both are published the same way, so a caller reading the
 * document sees exactly the statuses the handler is typed to return.
 */
function declaredAnswers(route: RestTransportRoute<unknown>): Record<string, RouteResponse> {
  if (route.rawResponse) return rawAnswer(route);

  const answers = route.answers ?? { [route.status ?? 200]: route.output };
  const published: Record<string, RouteResponse> = {};

  for (const [status, schema] of Object.entries(answers)) {
    published[status] = {
      description: answerDescription(Number(status)),
      content: { "application/json": { schema: answerSchema(schema) } },
    };
  }

  return published;
}

/** What a route that writes its own body publishes: the media types, no shape. */
function rawAnswer(route: RestTransportRoute<unknown>): Record<string, RouteResponse> {
  const status = String(route.status ?? 200);
  const content: RouteResponse["content"] = {};

  for (const mediaType of route.rawResponse?.produces ?? []) content[mediaType] = {};

  return { [status]: { description: answerDescription(Number(status)), content } };
}

/**
 * The published shape of one answer. A discriminated union is `oneOf` with the
 * field a caller branches on, which the schema resolver alone does not name, so
 * its members are converted here and the discriminator written beside them.
 */
function answerSchema(schema: RestTransportRoute<unknown>["output"]): unknown {
  if (schema instanceof z.ZodDiscriminatedUnion) {
    return {
      oneOf: schema.options.map((option) => publishedMember(option)),
      discriminator: { propertyName: schema.def.discriminator },
    };
  }

  return resolver(schema);
}

/** One member of a published union, without the draft the document declares. */
function publishedMember(option: z.core.$ZodType): Record<string, unknown> {
  const { $schema: _draft, ...member } = z.toJSONSchema(option, { io: "output" });

  return member;
}

/** The reason phrase a declared answer publishes; every 2xx is a success. */
function answerDescription(status: number): string {
  return RESPONSE_DESCRIPTIONS[status] ?? (status < 300 ? "Success" : `Response ${status}`);
}

/**
 * The answers an operation documents beyond its declared success, as the
 * declaration writes them: `documentedResponses({ 404: apiErrorSchema })`.
 */
export function documentedResponses(
  bodies: Readonly<Record<number, ZodType>>,
): Record<number, RouteResponse> {
  const responses: Record<number, RouteResponse> = {};

  for (const [status, schema] of Object.entries(bodies)) {
    responses[Number(status)] = {
      description: answerDescription(Number(status)),
      content: { "application/json": { schema: resolver(schema) } },
    };
  }

  return responses;
}

/** The reason phrase each documented status is published with. */
const RESPONSE_DESCRIPTIONS: Readonly<Record<number, string>> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  410: "Gone",
  413: "Payload Too Large",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  503: "Service Unavailable",
};

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
  internal_secret: [{ internal_secret: [] }],
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
// Marking a route, or a whole family, superseded.
// ─────────────────────────────────────────────────────────────────────────────

/** The sentence a deprecated answer carries, written or derived. */
export function deprecationNotice({
  successor,
  notice,
}: RestDeprecation): string {
  return notice ?? `This endpoint is deprecated; use ${successor}`;
}

/**
 * The four deprecation headers, on every answer of whatever it is applied to:
 * a declared route through the runtime, or a whole family through the mount's
 * own middleware, which is how a plural alias marks itself.
 */
export function deprecatedAlias(deprecation: RestDeprecation): MiddlewareHandler {
  const notice = deprecationNotice(deprecation);

  return async (c, next) => {
    // Prepared before the handler runs, so a refusal the family THROWS carries
    // them too: a header written after `next()` is never reached once the
    // error is on its way to the boundary.
    c.header("Deprecation", "true");
    c.header("Link", `<${deprecation.successor}>; rel="successor-version"`);
    c.header("X-API-Deprecation-Notice", notice);
    c.header("Warning", `299 - "${notice}"`);
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
