/**
 * What the published document says about a route: the operation block, the security
 * requirement its credential class publishes, the 3.1 spelling of an exclusive bound, a
 * hand-written operation, the deprecation headers, and the external URL a caller is linked to.
 */
import type { MiddlewareHandler } from "hono";
import { describeRoute, resolver, type DescribeRouteOptions } from "hono-openapi";
import { z, type ZodType } from "zod";

import type { CredentialClass } from "../access-policy.ts";
import { securityRequirement } from "../access/access.ts";
import type { RestDeprecation, RestDoorCredential, RestTransportRoute } from "./declaration.ts";
import { idempotencyKeyParameter } from "./idempotency.ts";
import type { RestMultipart } from "./request.ts";
import type { EndpointDocs, RouteResponse } from "./response.ts";

// What a declared REST route publishes: operation id and the answer the declaration named.
// Parameters and runtime-parsed bodies are NOT written here (hono-openapi validators carry
// that metadata). Routes that read their own bytes (no validator) have their body written here.

/**
 * One documented answer: whole, or words alone — an entry without `content`
 * inherits it from what the declaration derived for the same status.
 */
export type DocumentedRouteResponse = Omit<RouteResponse, "content"> &
  Partial<Pick<RouteResponse, "content">>;

export type RestTransportDocs = Readonly<{
  readonly summary?: string;
  readonly description?: string;
  /** The groups the operation is filed under in the published reference. */
  readonly tags?: readonly string[];
  /** Kept out of the published document: an alias or a compatibility path. */
  readonly hide?: boolean;
  /**
   * A refusal documented beyond the declared success: a status and a sentence, never a body. A
   * route whose error has a schema names it through `responses`/`documentedResponses()` instead.
   */
  readonly errors?: readonly Readonly<{ status: number; description: string }>[];
  /**
   * Answers documented beyond the success and `errors`, merged over the generated block per status:
   * for the rare response with its OWN schema, built by `documentedResponses()` from real Zod.
   */
  readonly responses?: Readonly<Record<number, DocumentedRouteResponse>>;
  /**
   * The shape a caller sends a route that reads its own body: the handler still parses those
   * bytes itself, but a reader of the document still needs to know what to write. Published
   * like any other body.
   */
  readonly requestBody?: Readonly<{
    description?: string;
    schema: ZodType;
    /** False where the route reads an absent body as a request of its own; true by default. */
    required?: boolean;
  }>;
}>;

/**
 * The operation id one mount publishes. Every version mount needs a distinct id since OpenAPI
 * requires uniqueness across the document: the declared name belongs to the bare alias a
 * client is told to call, and every other mount suffixes the version it serves.
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
    responses: documentedAnswers(route),
    operationId: operationIdOf({ operation: route.operation, suffix }),
  };

  if (route.docs?.description !== undefined) options.description = route.docs.description;

  if (route.docs?.summary !== undefined) options.summary = route.docs.summary;

  if (route.docs?.tags !== undefined) options.tags = [...route.docs.tags];

  if (route.docs?.hide) options.hide = true;

  if (route.idempotency) options.parameters = [idempotencyKeyParameter];

  const requestBody = publishedRequestBody(route);

  if (requestBody) options.requestBody = requestBody;

  // The credential this route actually reaches by: its own where it raised
  // one, else the family door's. Never the document's default, which is one
  // scheme and would describe every organization route as a project one.
  const reaches = route.credential ?? credential;

  // An empty requirement list is the document's way of saying "no credential",
  // which is exactly what a public route is; it also overrides the document's
  // own default requirement.
  if (route.access?.kind === "public") options.security = [];
  // An optional credential publishes both alternatives: the empty requirement
  // for the caller who presents none, and the route's own scheme beside it.
  else if (route.access?.kind === "optional" && reaches) {
    options.security = [{}, ...securityRequirement(reaches)];
  }
  // Every other documented operation states its own scheme: inheriting the default advertised
  // `project_api_key` on 626 of 659 operations (2026-09-21). `browser` has no presentable scheme,
  // so it keeps the family's own.
  else if (reaches && reaches !== "browser") options.security = [...securityRequirement(reaches)];

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
 * The body one operation publishes. A declaration that wrote its request out
 * is honoured first, under the media type the route reads: a route that parses
 * its own bytes still has a shape a caller has to send.
 */
function publishedRequestBody(
  route: RestTransportRoute<unknown>,
): DescribeRouteOptions["requestBody"] {
  const declared = route.docs?.requestBody;

  if (declared) {
    const description = declared.description;

    return {
      required: declared.required ?? true,
      ...(description === undefined ? {} : { description }),
      content: {
        [route.rawBody?.mediaType ?? "application/json"]: {
          schema: publishedInput(declared.schema),
        },
      },
    };
  }

  // The body of a route nothing parses, which named no shape of its own: the
  // media type it is sent as, and no schema.
  if (route.rawBody) return { required: true, content: { [route.rawBody.mediaType]: {} } };

  if (route.multipart) {
    return {
      required: true,
      content: { "multipart/form-data": { schema: multipartSchema(route.multipart) } },
    };
  }

  if (route.input && !requiresBody(route.input)) return optionalJsonBody(route.input);

  return undefined;
}

/**
 * Whether a JSON body must be sent. The runtime reads an absent body as `{}`
 * (ARCHITECTURE.md §8), so a schema that accepts `{}` does not need one, and its
 * validator leaves the body to this document rather than publishing it required.
 */
export function requiresBody(schema: ZodType): boolean {
  return !schema.validate({});
}

/** A body a caller may leave out: none at all for an empty input, else an optional one. */
function optionalJsonBody(schema: ZodType): DescribeRouteOptions["requestBody"] {
  if (schema instanceof z.ZodObject && Object.keys(schema.shape).length === 0) return undefined;

  return { required: false, content: { "application/json": { schema: publishedInput(schema) } } };
}

/** The shape a caller sends, as the document spells it, without the draft line. */
function publishedInput(schema: ZodType): Record<string, unknown> {
  const { $schema: _draft, ...published } = z.toJSONSchema(schema, {
    io: "input",
    unrepresentable: "any",
  });

  return published;
}

/**
 * The published shape of a multipart body: the fields the route parses, and one binary
 * property per file part it named, required where the declaration said the request must
 * carry it. Files publish as binary strings — how OpenAPI 3.1 spells an uploaded file.
 */
function multipartSchema(multipart: RestMultipart): Record<string, unknown> {
  const fields = publishedInput(multipart.fields);
  const properties = { ...(fields.properties as Record<string, unknown> | undefined) };
  const required = [...((fields.required as string[] | undefined) ?? [])];

  for (const [name, part] of Object.entries(multipart.files)) {
    properties[name] = { type: "string", format: "binary" };

    if (part.required) required.push(name);
  }

  return { ...fields, type: "object", properties, ...(required.length > 0 ? { required } : {}) };
}

/**
 * The declared answers with the docs' entries laid over them one status at a
 * time. A docs entry that states no content keeps the declared one, so the
 * schema `withOutput` named is never restated just to put words on a status.
 */
function documentedAnswers(route: RestTransportRoute<unknown>): Record<string, RouteResponse> {
  const declared = declaredAnswers(route);
  const published: Record<string, RouteResponse> = { ...declared };

  for (const error of route.docs?.errors ?? []) {
    published[String(error.status)] = { description: error.description, content: {} };
  }

  for (const [status, stated] of Object.entries(route.docs?.responses ?? {})) {
    published[status] = { ...stated, content: stated.content ?? declared[status]?.content ?? {} };
  }

  return published;
}

/**
 * Every answer the DECLARATION named: the one success from `withOutput`, or each status of
 * a route that declared several with `responds`. Both publish the same way, so a caller
 * reading the document sees exactly the statuses the handler is typed to return.
 */
function declaredAnswers(route: RestTransportRoute<unknown>): Record<string, RouteResponse> {
  if (route.rawResponse || route.response) return rawAnswer(route);

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
  const status = String(route.status ?? (route.response?.kind === "redirect" ? 303 : 200));
  const content: RouteResponse["content"] = {};

  const produces = route.rawResponse?.produces ?? route.response?.produces ?? [];

  for (const mediaType of produces) content[mediaType] = {};

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

  return resolver(schema, { options: { io: "output" } });
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
      content: { "application/json": { schema: resolver(schema, { options: { io: "output" } }) } },
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
 * The fixed Path Item members that are operations, per OpenAPI 3.1. A Path Item also holds
 * `servers`, `parameters`, `summary`, `description` and `$ref` — the first two are arrays,
 * which are objects to `typeof`, so walking by shape mistakes them for operations.
 */
const HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

/** Whether a Path Item member names an operation rather than path metadata. */
export function isHttpMethod(member: string): boolean {
  return HTTP_METHODS.has(member.toLowerCase());
}

/**
 * A route's path spelled as the document spells it: Hono's `:id` becomes `{id}`, else an
 * undocumented path falls back to the document's default security instead of the route's real
 * credential class. The inner alternation lets one nesting level consume a quantifier whole.
 */
export function documentedPathOf(honoPath: string): string {
  return honoPath.replace(/:([A-Za-z0-9_]+)(\{(?:[^{}]|\{[^{}]*\})*\})?/g, "{$1}");
}

/**
 * Which security scheme a consumer of each door credential presents. The one table: the
 * runtime reads it to classify a mounted route, and the generator reads it to classify a
 * declared one, so a family can't enforce one credential while advertising another.
 */
export const CREDENTIAL_CLASS_BY_DOOR = {
  project: "project_api_key",
  organization: "organization_api_key",
  apiKey: "project_api_key",
  scimToken: "scim_token",
  "instance-admin": "instance_admin_api_key",
  sessionKey: "project_api_key",
  cliToken: "cli_access_token",
  browser: "session",
  internalSecret: "internal_secret",
  public: "none",
} as const satisfies Record<RestDoorCredential | "public", CredentialClass>;

/**
 * Which security schemes the document offers for each credential class. Only classes an API
 * consumer can present appear — the omission is the point: an empty list means "no credential
 * required", true of a public route but false of a session-only or internal one, which refuse.
 */
const SECURITY_BY_CREDENTIAL_CLASS = {
  project_api_key: [{ project_api_key: [] }],
  organization_api_key: [{ admin_api_key: [] }],
  instance_admin_api_key: [{ instance_admin_key: [] }],
  scim_token: [{ scim_bearer: [] }],
  cli_access_token: [{ cli_access_token: [] }],
  internal_secret: [{ internal_secret: [] }],
  none: [],
} as const satisfies Record<
  Exclude<CredentialClass, "session" | "internal">,
  readonly SecurityRequirement[]
>;

/**
 * The security requirement a documented operation publishes; throws instead of an empty,
 * unauthenticated requirement when its credential class can't be presented by an API client.
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

// The 3.1 spelling of an exclusive bound. Document declares `openapi: 3.1.0` where
// `exclusiveMinimum` / `exclusiveMaximum` are numbers, but schema builders emit the 3.0 spelling
// (boolean flags). Strict validators reject it; client generators drop the bound or error.

/** Whether the value is a plain object worth walking into. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Rewrites every `exclusiveMinimum: true` / `exclusiveMaximum: true` into the numeric 3.1
 * form, in place: `{ minimum: 0, exclusiveMinimum: true }` becomes `{ exclusiveMinimum: 0 }`.
 * A flag with no bound beside it says nothing and is dropped; `false` needs no bound at all.
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

/**
 * Spells out every key an enum-keyed record accepts, in place: `z.partialRecord(z.enum(keys), v)`
 * publishes `propertyNames` and `additionalProperties` alone, which names no key a reader can
 * see. Each key becomes an optional property of the value's schema; the two constraints stay.
 */
export function publishEnumRecordKeys(document: unknown): void {
  if (Array.isArray(document)) {
    for (const child of document) publishEnumRecordKeys(child);

    return;
  }

  if (!isRecord(document)) return;

  for (const child of Object.values(document)) publishEnumRecordKeys(child);

  const keys = isRecord(document.propertyNames) ? document.propertyNames.enum : undefined;
  const value = document.additionalProperties;

  if (document.properties !== undefined || !isRecord(value) || !Array.isArray(keys)) return;

  if (!keys.every((key) => typeof key === "string")) return;

  document.properties = Object.fromEntries(keys.map((key) => [key, value]));
}

// zod's OpenAPI adapter rewrites a recursive schema's self-reference to
// `#/components/schemas/<name>` but leaves the definition itself sitting in
// that response's own local `$defs`, never hoisted — so the ref dangles the
// moment two routes' schemas share one document. `__schema0`-style anonymous
// names are not unique across routes, so hoisting renames per occurrence.

/**
 * Moves every schema's local `$defs` into `components.schemas` in place, renaming entries to stay
 * unique and rewriting every `$ref` (self-references included) to match.
 */
export function hoistStraySchemaDefs(document: unknown): void {
  const schemas = componentSchemasOf(document);

  if (!schemas) return;

  let nextId = 0;
  walkForDefs(document, schemas, () => `__hoisted${nextId++}`);
}

/** The document's own `components.schemas`, created when the generator wrote none. */
function componentSchemasOf(document: unknown): Record<string, unknown> | undefined {
  if (!isRecord(document)) return void 0;

  const components = (document.components ??= {});

  if (!isRecord(components)) return void 0;

  const schemas = (components.schemas ??= {});

  return isRecord(schemas) ? schemas : void 0;
}

function walkForDefs(
  node: unknown,
  schemas: Record<string, unknown>,
  nameGenerator: () => string,
): void {
  if (Array.isArray(node)) {
    for (const child of node) walkForDefs(child, schemas, nameGenerator);

    return;
  }

  if (!isRecord(node)) return;

  const defs = node.$defs;

  if (isRecord(defs)) {
    delete node.$defs;

    const renamed = new Map(Object.keys(defs).map((name) => [name, nameGenerator()]));

    rewriteRefs(node, renamed);

    for (const [name, definition] of Object.entries(defs)) {
      rewriteRefs(definition, renamed);
      schemas[renamed.get(name) ?? name] = definition;
    }
  }

  for (const child of Object.values(node)) walkForDefs(child, schemas, nameGenerator);
}

/** Rewrites every `$ref` naming an entry in `renamed` to its new component path. */
function rewriteRefs(node: unknown, renamed: ReadonlyMap<string, string>): void {
  if (Array.isArray(node)) {
    for (const child of node) rewriteRefs(child, renamed);

    return;
  }

  if (!isRecord(node)) return;

  const ref = node.$ref;

  if (typeof ref === "string") {
    const name = ref.split("/").pop();
    const newName = name === undefined ? undefined : renamed.get(name);

    if (newName !== undefined) node.$ref = `#/components/schemas/${newName}`;
  }

  for (const child of Object.values(node)) rewriteRefs(child, renamed);
}

// ─────────────────────────────────────────────────────────────────────────────
// A hand-written operation, for a family that documents what it parses itself.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `security` and path `parameters` are framework-derived, so dropped here rather than
 * restated. Everything else a person wrote carries through unchanged, including the request
 * body, since a family parsing its own body gives the framework no schema to derive one from.
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
export function deprecationNotice({ successor, notice }: RestDeprecation): string {
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
