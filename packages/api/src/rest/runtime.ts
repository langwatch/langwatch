/**
 * The REST transport: the version vocabulary a family serves at, the `/api/v1`
 * alias every family answers under, the process-wide route-policy registry,
 * `defineRestRouter` (one complete declaration per route) and the one execution
 * path a mounted route runs — parse, authenticate, decide, handle, check the
 * answer, respond.
 */
import { actorSchema, type Actor } from "@langwatch/actor";
import type {
  AuthzDeclaredScopeId,
  AuthzPermission,
  PermissionDecision,
  ScopeTierField,
} from "@langwatch/authz-contract";
import { createLogger, validationMeta } from "@langwatch/observability";
import type { FeatureApiToken } from "@langwatch/runtime-composition";
import { Temporal } from "@langwatch/time";
import type { Context, ErrorHandler, Hono as HonoApp, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { mergePath } from "hono/utils/url";
import { uniqueSymbol, validator as openApiValidator } from "hono-openapi";
import { z } from "zod";

import {
  handlerManagedAuth,
  publicEndpoint,
  type AccessPolicy,
  type CredentialClass,
  type HandlerCredential,
} from "../access-policy.ts";
import {
  assertRouteScopePermission,
  decide,
  routeScopeOf,
  SCOPE_INPUT_FIELDS,
  type AccessDenialPort,
  type AuthorizePort,
  type Credential,
  type RouteAccess,
} from "../access/access.ts";
import { ApiVersionConflictError, InvalidApiVersionError, RateLimitedError } from "../errors.ts";
import type { ApiHandlerArguments } from "../handler-arguments.ts";
import type { RateLimiter, ResponseCache } from "../ports.ts";
import type { RestResolvedInternalCredential } from "./credential.ts";
import { deprecatedAlias, deprecationNotice, documentRoute } from "./openapi.ts";
import {
  bodyLimit,
  cachedRestAnswer,
  defineRestMiddleware,
  loggerMiddleware,
  multipartMiddleware,
  requestValidationErrorFrom,
  restCacheKey,
  restRateLimitKey,
  storeRestAnswer,
  tracerMiddleware,
  type RestCachePolicy,
  type RestMultipart,
  type RestMultipartFiles,
  type RestRateLimitPolicy,
  type RestTransportMiddleware,
  type RestTransportMiddlewareBinding,
} from "./request.ts";
import {
  DECLARED_ANSWER,
  ENDPOINT_ROUTE,
  isDeclined,
  REQUEST_FAMILY,
  type Declined,
  type RouteResponse,
} from "./response.ts";

const outputLogger = createLogger("langwatch:api:output-validation");

// ─────────────────────────────────────────────────────────────────────────────
// Version primitives.
// ─────────────────────────────────────────────────────────────────────────────

/** A date-based API version string, e.g. `"2025-03-15"`. Validated at runtime. */
export type DateVersion = string;

export const VERSION_LATEST = "latest" as const;
export const VERSION_PREVIEW = "preview" as const;
export const API_VERSION_HEADER = "X-API-Version" as const;

/**
 * The version argument of a registration: a real calendar date, or `"preview"`
 * for an endpoint that lives only in the preview namespace. `"latest"` is
 * derived, never registered.
 */
export type VersionLabel = DateVersion | typeof VERSION_PREVIEW;

/** The version status header value a mount responds with. */
export type VersionStatus = "stable" | "latest" | "preview";

/**
 * `head` is registered for the registry and the published document only: Hono
 * answers a HEAD request from the GET route BEFORE routing, so a HEAD handler
 * never runs. Register it beside the GET whose headers it describes.
 */
export type HttpMethod = "get" | "head" | "post" | "put" | "delete" | "patch";

/** A family's Hono app as a mount target. */
export type MountableRestApp = Hono<any, any, any>;

/**
 * The one dated version every management API family serves.
 *
 * The management surface shipped as a single product decision, so its families
 * version together: a caller pins `/api/<family>/2026-08-07/...` and gets the
 * same vintage everywhere, and a future breaking change bumps this constant in
 * exactly one place per family.
 */
export const MANAGEMENT_API_VERSION = "2026-08-07";

const DATE_VERSION_RE = /^20\d{2}-\d{2}-\d{2}$/;

/** Returns true when `value` is a real calendar date in `YYYY-MM-DD` form. */
export function isDateVersion(value: string): value is DateVersion {
  if (!DATE_VERSION_RE.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number);
  const date = Temporal.PlainDate.from({ year: year!, month: month!, day: day! });

  return date.year === year && date.month === month && date.day === day;
}

/** Asserts the version argument of a declaration. */
export function assertVersionLabel(version: string): void {
  if (version === VERSION_PREVIEW) return;
  if (version === VERSION_LATEST) {
    throw new Error(
      `API version "latest" is derived from the dated registrations and ` +
        `cannot be registered; name a real date in YYYY-MM-DD form`,
    );
  }
  if (!isDateVersion(version)) {
    throw new RangeError(
      `Invalid API version "${version}"; expected a real date in YYYY-MM-DD form`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The canonical `/api/v1` alias every `/api` family answers under.
// ─────────────────────────────────────────────────────────────────────────────

/** The canonical published API generation. */
export const V1_PREFIX = "/api/v1";

const VERSION_SEGMENT = /^v\d+$/;

/**
 * The `/api/v1` form of a bare `/api/...` route path, or `null` when the path
 * must not be aliased.
 */
export function canonicalV1Path(path: string): string | null {
  if (path !== "/api" && !path.startsWith("/api/")) return null;
  const rest = path.slice("/api".length);
  if (rest === "" || rest === "/") return null;
  const segments = rest.split("/").filter((segment) => segment.length > 0);
  if (segments.some((segment) => VERSION_SEGMENT.test(segment))) return null;
  return `${V1_PREFIX}${rest}`;
}

/** The same handler stack with hono-openapi's route metadata detached. */
export function undescribedStack(stack: readonly MiddlewareHandler[]): MiddlewareHandler[] {
  return stack.map((handler) => {
    if (Reflect.get(handler, uniqueSymbol) === void 0) return handler;
    const passthrough: MiddlewareHandler = async (context, next) => handler(context, next);
    return passthrough;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Static generation selection, for a surface whose contract is a generation
// rather than a date.
// ─────────────────────────────────────────────────────────────────────────────

export type RestVersionSource = "path" | "header" | "latest";

export type RestVersionSelection = Readonly<{
  version: string;
  source: RestVersionSource;
}>;

export type RestVersionSelectorOptions = Readonly<{
  versions: readonly string[];
  latestVersion: string;
  headerName?: string;
}>;

export type RestVersionSelectorMiddlewareOptions = Readonly<{
  selector: RestVersionSelector;
  pathVersion?: string;
}>;

/**
 * Selects a static public-REST generation independently from date contract
 * negotiation. A feature mount supplies its explicit path generation, if any.
 */
export class RestVersionSelector {
  static create(options: RestVersionSelectorOptions): RestVersionSelector {
    return new RestVersionSelector(options);
  }

  readonly headerName: string;
  private readonly versions: ReadonlySet<string>;
  private readonly latestVersion: string;

  private constructor({
    headerName = API_VERSION_HEADER,
    latestVersion,
    versions,
  }: RestVersionSelectorOptions) {
    if (versions.length === 0) {
      throw new Error("REST version selector requires at least one supported version");
    }
    if (new Set(versions).size !== versions.length) {
      throw new Error("REST version selector versions must be unique");
    }
    if (versions.some((version) => version.trim() === "")) {
      throw new Error("REST version selector versions must not be blank");
    }
    if (!versions.includes(latestVersion)) {
      throw new Error("REST version selector latestVersion must be supported");
    }
    if (headerName.trim() === "") {
      throw new Error("REST version selector headerName must not be blank");
    }

    this.headerName = headerName;
    this.versions = new Set(versions);
    this.latestVersion = latestVersion;
  }

  select({
    pathVersion,
    headerVersion,
  }: Readonly<{ pathVersion?: string; headerVersion?: string }>): RestVersionSelection {
    if (pathVersion !== void 0 && headerVersion !== void 0 && pathVersion !== headerVersion) {
      throw new ApiVersionConflictError();
    }
    if (pathVersion !== void 0) {
      this.assertSupported(pathVersion);
    }
    if (headerVersion !== void 0) {
      this.assertSupported(headerVersion);
    }
    if (pathVersion !== void 0) {
      return { version: pathVersion, source: "path" };
    }
    if (headerVersion !== void 0) {
      return { version: headerVersion, source: "header" };
    }
    return { version: this.latestVersion, source: "latest" };
  }

  private assertSupported(version: string): void {
    if (!this.versions.has(version)) {
      const supported = [...this.versions].join(", ");
      throw new InvalidApiVersionError(`one of ${supported}`);
    }
  }
}

/** Applies static generation negotiation to a hand-mounted REST transport. */
export function restVersionSelectorMiddleware({
  pathVersion,
  selector,
}: RestVersionSelectorMiddlewareOptions): MiddlewareHandler {
  return async (context, next) => {
    const selection = selector.select({
      pathVersion,
      headerVersion: context.req.header(selector.headerName) ?? void 0,
    });
    try {
      await next();
    } finally {
      context.header(API_VERSION_HEADER, selection.version);
      context.header("X-API-Version-Status", selection.source === "latest" ? "latest" : "stable");
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The process-wide route-policy registry.
//
// Populated as each family mounts. The router-introspection guard cross-checks
// the composed router against it, so any mounted route lacking a declared
// policy — even one that bypassed the runtime — fails CI.
// ─────────────────────────────────────────────────────────────────────────────

export interface RegisteredRoute {
  readonly method: string;
  readonly path: string;
  readonly policy: AccessPolicy;
  readonly family: string;
  /**
   * Which credential an API consumer sends here. Derived by the runtime from
   * the mount and the route, so a route cannot claim a credential class
   * nothing enforces. Read by the OpenAPI generator to stamp each operation's
   * `security`.
   */
  readonly credentialClass: CredentialClass;
  /**
   * The `/api/v1` path this same route also answers at. One logical route with
   * two addresses, so an authorization audit and the document's drift guard
   * count it once and still recognise the canonical published URL.
   */
  readonly canonicalPath?: string;
  /**
   * True when this mount answers 410 Gone for a withdrawn endpoint. No handler
   * stands behind it, so the route-coverage gate accounts for it by shape.
   */
  readonly withdrawn?: boolean;
  /**
   * True for the catch-alls that 404 an unknown version namespace. Real routes
   * in the table, and undocumentable for the same reason a tombstone is.
   */
  readonly isNamespaceGuard?: boolean;
}

const registry = new Map<string, RegisteredRoute>();

function registryKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

/** Record (or overwrite, idempotently) the policy for a (method, path). */
export function registerRoutePolicy(route: RegisteredRoute): void {
  registry.set(registryKey(route.method, route.path), {
    ...route,
    method: route.method.toUpperCase(),
  });
}

export function getRoutePolicy(method: string, path: string): RegisteredRoute | undefined {
  return registry.get(registryKey(method, path));
}

export function allRegisteredRoutes(): RegisteredRoute[] {
  return [...registry.values()];
}

// ─────────────────────────────────────────────────────────────────────────────
// `defineRestRouter`: one complete declaration per route, under a namespace and
// a version. REST shares no declaration with a browser client the way tRPC
// does, so each route states its whole identity here.
// ─────────────────────────────────────────────────────────────────────────────

/** The portable part of a feature API token; no runtime-composition dependency. */
export type FeatureApiWitness<Api> = FeatureApiToken<Api>;

type SourceSchema = z.ZodObject | z.ZodDiscriminatedUnion<readonly z.ZodObject[]>;
type Missing = undefined;
type RouteSource = SourceSchema | RestRawBodyDeclared | RestMultipartDeclared | Missing;
type PathParameterNames<Path extends string> = Path extends `${string}:${infer Tail}`
  ? Tail extends `${infer Name}/${infer Rest}`
    ? Name | PathParameterNames<`/${Rest}`>
    : Tail
  : never;
type ExactPathSchema<Path extends string, Schema extends z.ZodObject> =
  Exclude<keyof Schema["shape"], PathParameterNames<Path>> extends never
    ? Exclude<PathParameterNames<Path>, keyof Schema["shape"]> extends never
      ? Schema
      : never
    : never;
type UnionKeys<Value> = Value extends unknown ? keyof Value : never;
type DistinctSchema<
  Schema extends SourceSchema,
  Other extends RouteSource,
> = Other extends SourceSchema
  ? Extract<UnionKeys<z.output<Schema>>, UnionKeys<z.output<Other>>> extends never
    ? Schema
    : never
  : Schema;
type SourceInput<Schema extends RouteSource> = Schema extends SourceSchema
  ? z.output<Schema>
  : unknown;
/**
 * A raw body is read, never parsed, so it contributes nothing to the input; a
 * multipart body contributes the fields it declared, and its files arrive
 * beside the input rather than inside it.
 */
type ParsedBody<Body extends RouteSource> = Body extends RestRawBodyDeclared
  ? Missing
  : Body extends RestMultipartDeclared<infer Fields, RestMultipartFiles>
    ? Fields
    : Body;
type RouteInput<Params extends RouteSource, Query extends RouteSource, Body extends RouteSource> = [
  Params,
  Query,
  ParsedBody<Body>,
] extends [Missing, Missing, Missing]
  ? undefined
  : SourceInput<Params> & SourceInput<Query> & SourceInput<ParsedBody<Body>>;
/**
 * The body a route answers with, as a schema. A discriminated union is one
 * answer with several shapes — a create that either found the object or started
 * an upload — and publishes as `oneOf` with its discriminator.
 */
type OutputSchema =
  | z.ZodObject
  | z.ZodArray
  | z.ZodVoid
  | z.ZodUndefined
  | z.ZodDiscriminatedUnion<readonly z.ZodObject[]>;

export type RestTransportDocs = Readonly<{
  readonly summary?: string;
  readonly description?: string;
  /** The groups the operation is filed under in the published reference. */
  readonly tags?: readonly string[];
  /**
   * The answers the operation documents beyond its declared success, built by
   * `documentedResponses`. Merged over the generated success block.
   */
  readonly responses?: Readonly<Record<number, RouteResponse>>;
}>;

/**
 * How a family is addressed: `dated` publishes its dated, latest and bare
 * paths with their `/api/v1` twins; `v1-only` and `v1-in-path` publish one
 * generation, which is their whole contract; `literal` publishes exactly the
 * paths its routes write, for a family sharing a prefix rather than owning it.
 */
export type RestAddressing = "dated" | "v1-only" | "v1-in-path" | "literal";

/**
 * What a family may say about its addresses: `v1Twin: false` for one whose
 * paths were never aliased, and the `generation` a `v1-in-path` family names
 * in its own path, for a protocol whose generation is not ours to choose.
 */
export type RestAddressingOptions = Readonly<{ v1Twin?: boolean; generation?: string }>;

/**
 * What a project-scoped door knows about the caller beyond the request's own
 * input: the slug a platform URL is built from, the person a personal view is
 * filtered for, and the actor an action is recorded against. Named here, in the
 * file that binds facts, so every project family declares the same one.
 */
export const projectRestFacts = defineRestMiddleware(
  "projectRestFacts",
  z.object({
    projectSlug: z.string(),
    viewerUserId: z.string().nullable(),
    actorId: z.string(),
  }),
);

/** What a superseded family or route answers with, and what replaces it. */
export type RestDeprecation = Readonly<{
  /** The path of the family or route that replaces this one. */
  readonly successor: string;
  readonly notice?: string;
}>;

/**
 * The credentials a declaration may choose a door for. `public` is absent on
 * purpose: nothing is resolved for it, so a declaration naming it would type
 * its handler's scope as a value no door establishes. A route answering
 * without a credential declares `publicRoute` access instead.
 */
export type RestDoorCredential = Extract<
  Credential,
  "projectKey" | "organizationKey" | "scimToken" | "internalSecret" | "instanceAdminKey" | "session"
>;

/**
 * Which scope tier each door's credential resolves. The one table: the type a
 * handler reads and the tier the runtime asserts both come from here, so a door
 * cannot promise one tier and hand over another. `null` is a door whose
 * credential names no tenant at all — a deployment's own shared secret.
 */
const DOOR_SCOPE_TIER = {
  projectKey: "project",
  organizationKey: "organization",
  scimToken: "organization",
  session: "project",
  internalSecret: null,
  instanceAdminKey: null,
} as const satisfies Record<RestDoorCredential, AuthzDeclaredScopeId["tier"] | null>;

/** The scope a handler on `Door` is handed: the tier that door resolves. */
type DoorScope<Door extends RestDoorCredential> = (typeof DOOR_SCOPE_TIER)[Door] extends null
  ? null
  : Extract<AuthzDeclaredScopeId, { tier: (typeof DOOR_SCOPE_TIER)[Door] }>;
type ScopedHandlerArguments<Input, App, Door extends RestDoorCredential> = Omit<
  ApiHandlerArguments<Input, App>,
  "scope"
> & {
  readonly scope: DoorScope<Door>;
  /**
   * The scope this route's own path named, when its permission was checked
   * there; `null` on every route checked at the credential's own scope.
   */
  readonly target: AuthzDeclaredScopeId | null;
};
/** A public route resolves no credential, so it knows neither actor nor scope. */
type PublicHandlerArguments<Input, App> = Omit<
  ApiHandlerArguments<Input, App>,
  "actor" | "scope"
> & {
  readonly actor: null;
  readonly scope: null;
  readonly target: null;
};
/**
 * A route the door answers with or without a credential: both halves of the
 * caller are nullable together, so a handler cannot read one and assume the
 * other.
 */
type OptionalHandlerArguments<Input, App, Door extends RestDoorCredential> = Omit<
  ApiHandlerArguments<Input, App>,
  "actor" | "scope"
> & {
  readonly actor: Actor | null;
  readonly scope: DoorScope<Door> | null;
  readonly target: null;
};
type DeferredHandlerArguments<Input, App> = Omit<
  ApiHandlerArguments<Input, App>,
  "actor" | "scope"
> & {
  readonly actor: Actor | null;
  readonly scope: null;
  readonly target: null;
};
type HandlerArgumentsFor<
  Access extends RouteAccessKind,
  Input,
  App,
  Door extends RestDoorCredential,
> = Access extends "public"
  ? PublicHandlerArguments<Input, App>
  : Access extends "optional"
    ? OptionalHandlerArguments<Input, App, Door>
    : Access extends "deferred"
      ? DeferredHandlerArguments<Input, App>
      : ScopedHandlerArguments<Input, App, Door>;
type RouteAccessKind = "scoped" | "public" | "authenticated" | "optional" | "deferred";
/**
 * What a stored handler is invoked with, once the declaration's own types are
 * gone: every door's arguments widened to one shape. The `handle` signature is
 * where a handler's real types are enforced; this is only what the runtime
 * calls, declared as a method so the parameter stays bivariant.
 */
type StoredHandlerArguments<Api> = Readonly<{
  app: Api;
  input: unknown;
  actor: Actor | null;
  scope: AuthzDeclaredScopeId | null;
  target: AuthzDeclaredScopeId | null;
  signal: AbortSignal | undefined;
  /** Read once, only for a route that declared it; undefined everywhere else. */
  raw: string | Uint8Array | undefined;
  /** The file parts a multipart route named; undefined everywhere else. */
  files: Readonly<Record<string, File>> | undefined;
  request: Request;
}>;
type StoredHandler<Api> = {
  invoke(args: StoredHandlerArguments<Api>, ...facts: unknown[]): unknown;
}["invoke"];
/**
 * A handler with its declaration's own types erased. The door, the raw form and
 * the parsed input each shape the arguments differently, so no one written
 * signature is comparable to all of them; `handle` is where they are enforced.
 */
type ErasedHandler = (args: never, ...facts: never[]) => unknown;
type MiddlewareFacts<Middleware extends readonly RestTransportMiddleware[]> = {
  [Index in keyof Middleware]: z.output<Middleware[Index]["schema"]>;
};
// ─────────────────────────────────────────────────────────────────────────────
// Bytes in and bytes out: the two declarations that take the framework's parser
// and serialiser off a route, for a body that IS the evidence and an answer
// that is not JSON.
// ─────────────────────────────────────────────────────────────────────────────

/** How a route that reads its own body wants the bytes it was sent. */
export type RestRawBodyForm = "text" | "bytes";

/**
 * A route whose body is the evidence — a signature is computed over the exact
 * characters a sender wrote, spacing included — so nothing parses it: the form
 * the handler reads it in, and the media type the document publishes for it.
 */
export type RestRawBody = Readonly<{ form: RestRawBodyForm; mediaType: string }>;

/** What the handler is handed for the form it asked for. */
type RawBodyValue<Form extends RestRawBodyForm> = Form extends "text" ? string : Uint8Array;

/** The `Body` slot of a route that reads its own bytes. */
export type RestRawBodyDeclared<Form extends RestRawBodyForm = RestRawBodyForm> = Readonly<{
  rawBody: Form;
}>;

/** The `Body` slot of a route whose request carries files beside its fields. */
export type RestMultipartDeclared<
  Fields extends z.ZodObject = z.ZodObject,
  Files extends RestMultipartFiles = RestMultipartFiles,
> = Readonly<{ multipartFields: Fields; multipartFiles: Files }>;

/** What a route that writes its own body publishes, and nothing of its shape. */
export type RestRawResponse = Readonly<{ produces: readonly string[] }>;

/** The body a raw answer carries; `null` for a 204, a 304, or a HEAD twin. */
export type RestRawBodyOut = ReadableStream | Uint8Array | string | null;

/** The answer of a route that writes its own bytes. */
export type RestRawAnswer = Readonly<{
  status?: ContentfulStatusCode;
  headers?: Readonly<Record<string, string>>;
  body: RestRawBodyOut;
}>;

/**
 * What a raw-answering handler returns: its own answer, a whole `Response` it
 * is forwarding, or — on an any-method route alone — a decline, which hands the
 * request to whatever is mounted after this family.
 */
export type RestRawResult = RestRawAnswer | Response | Declined;

/** The `Output` slot of a route that writes its own bytes: no schema at all. */
export type RestRawAnswerDeclared = Readonly<{ rawAnswer: "declared" }>;

/** The methods a route may name, spelled the way HTTP spells them. */
export type RestMethodName = Uppercase<HttpMethod>;

/** The statuses a route declares answers for, each with the body it carries. */
export type RestRouteAnswers = Readonly<Record<number, OutputSchema>>;
type AnswerResult<Answers extends RestRouteAnswers> = {
  [Status in keyof Answers]: Readonly<{
    status: Status & ContentfulStatusCode;
    body: z.input<Answers[Status] & OutputSchema>;
  }>;
}[keyof Answers];
/**
 * What the handler returns: its own bytes, the one declared body, one
 * `{ status, body }` of the several a route declared, or nothing. The answer
 * slot holds exactly one of those, so a route states its answers in one place.
 */
type RouteResult<Output extends RouteAnswer> = Output extends RestRawAnswerDeclared
  ? RestRawResult | Promise<RestRawResult>
  : Output extends OutputSchema
    ? z.input<Output> | Promise<z.input<Output>>
    : Output extends RestRouteAnswers
      ? AnswerResult<Output> | Promise<AnswerResult<Output>>
      : void | Promise<void>;
type RouteAnswer = OutputSchema | RestRouteAnswers | RestRawAnswerDeclared | Missing;

/** The bytes a route that declared a raw body is handed, beside its input. */
type RawBodyArguments<Body extends RouteSource> = Body extends RestRawBodyDeclared<infer Form>
  ? Readonly<{ raw: RawBodyValue<Form> }>
  : unknown;

/**
 * The files a multipart route is handed, beside its input: each part it named,
 * present for certain when the declaration said the request must carry it.
 */
type MultipartArguments<Body extends RouteSource> = Body extends RestMultipartDeclared<
  z.ZodObject,
  infer Files
>
  ? Readonly<{
      files: {
        readonly [Name in keyof Files]: Files[Name]["required"] extends true
          ? File
          : File | undefined;
      };
    }>
  : unknown;

/**
 * The request a route that writes its own bytes reads for itself: the method an
 * any-method route dispatches on, and the whole `Request` an alias forwards.
 */
type RawResponseArguments<Output extends RouteAnswer> = Output extends RestRawAnswerDeclared
  ? Readonly<{ request: Request }>
  : unknown;

/**
 * Where a route's permission is checked. `route` asks it at the scope the
 * route's own path names — the project or the team it addresses — rather than
 * at the one the credential resolved. The parameter is the field that tier is
 * spelled with, so the tier follows the name.
 */
export type RestPermissionTarget = Readonly<{ at: "route"; param: ScopeTierField }>;

export type RestTransportRoute<Api> = Readonly<{
  readonly method: HttpMethod;
  readonly path: string;
  readonly operation: string;
  readonly version: DateVersion;
  readonly docs?: RestTransportDocs;
  readonly params?: z.ZodObject;
  readonly input?: SourceSchema;
  /** Absent exactly when the route declared an access kind instead. */
  readonly permission?: AuthzPermission;
  /** Where that permission is asked; absent means at the credential's scope. */
  readonly permissionTarget?: RestPermissionTarget;
  /** Present exactly when the route named an access kind instead. */
  readonly access?: RouteAccess;
  readonly permissionScope?: string;
  readonly query?: z.ZodObject;
  readonly output: OutputSchema;
  /** Present exactly when the route declared several answers with `responds`. */
  readonly answers?: RestRouteAnswers;
  /** Present exactly when the route reads its own body instead of parsing one. */
  readonly rawBody?: RestRawBody;
  /** Present exactly when the route's request carries files beside its fields. */
  readonly multipart?: RestMultipart;
  /** Present exactly when the route counts how often one caller may ask. */
  readonly rateLimit?: RestRateLimitPolicy;
  /** Present exactly when the route's answer stands for a while. */
  readonly cache?: RestCachePolicy;
  /** Present exactly when the route writes its own body instead of a schema's. */
  readonly rawResponse?: RestRawResponse;
  /** Every method this one declaration answers; the declared method alone by default. */
  readonly methods?: readonly HttpMethod[];
  /** True for the one route of a path that answers whatever method arrives. */
  readonly anyMethod?: boolean;
  readonly status?: ContentfulStatusCode;
  readonly middleware?: readonly RestTransportMiddleware[];
  readonly bodyLimit?: Readonly<{ maxBytes: number; onExceeded(): Error }>;
  readonly deprecated?: RestDeprecation;
  readonly handler: StoredHandler<Api>;
}>;

/** Inert REST transport metadata consumed by a process-owned mount adapter. */
export type RestTransportDeclaration<Api> = Readonly<{
  readonly protocol: "rest";
  readonly api: FeatureApiWitness<Api>;
  /** The family's own path segment: `/api/<namespace>`. */
  readonly namespace: string;
  readonly version: DateVersion;
  readonly addressing: RestAddressing;
  /** Whether the family's `dated` addresses also answer under `/api/v1`. */
  readonly v1Twin: boolean;
  /** The generation a `v1-in-path` family names in its own path. */
  readonly generation: string;
  /**
   * The door these routes are answered behind, and so the scope every handler
   * is handed. Declared, not mounted: the handler's own type follows it.
   */
  readonly credential: RestDoorCredential;
  /** Applies to every route the family declares, unless a route names its own. */
  readonly deprecated?: RestDeprecation;
  readonly routes: readonly RestTransportRoute<Api>[];
}>;

/** Everything a route has declared so far, before `handle` freezes it. */
type RouteState = Readonly<{
  params?: z.ZodObject;
  input?: SourceSchema;
  query?: z.ZodObject;
  output?: OutputSchema;
  answers?: RestRouteAnswers;
  rawBody?: RestRawBody;
  multipart?: RestMultipart;
  rateLimit?: RestRateLimitPolicy;
  cache?: RestCachePolicy;
  rawResponse?: RestRawResponse;
  methods?: readonly HttpMethod[];
  anyMethod?: boolean;
  permission?: AuthzPermission;
  permissionTarget?: RestPermissionTarget;
  access?: RouteAccess;
  version?: DateVersion;
  docs?: RestTransportDocs;
  status?: ContentfulStatusCode;
  middleware?: readonly RestTransportMiddleware[];
  bodyLimit?: Readonly<{ maxBytes: number; onExceeded(): Error }>;
  deprecated?: RestDeprecation;
}>;

type RouteReady<
  Path extends string,
  Params extends RouteSource,
  Permission extends boolean,
> = Permission extends true
  ? PathParameterNames<Path> extends never
    ? true
    : Params extends SourceSchema
      ? true
      : false
  : false;

class RouteBuilder<
  Api,
  Method extends HttpMethod,
  Path extends string,
  Params extends RouteSource = Missing,
  Body extends RouteSource = Missing,
  Query extends RouteSource = Missing,
  Output extends RouteAnswer = Missing,
  Permission extends boolean = false,
  Middleware extends readonly RestTransportMiddleware[] = [],
  Access extends RouteAccessKind = "scoped",
  Door extends RestDoorCredential = "projectKey",
> {
  constructor(
    private readonly router: RestTransportRouter<Api, Door>,
    private readonly method: Method,
    private readonly path: Path,
    private readonly operation: string,
    private readonly state: RouteState = {},
  ) {}

  withParams<Schema extends z.ZodObject>(
    schema: ExactPathSchema<Path, Schema> &
      DistinctSchema<Schema, Body> &
      DistinctSchema<Schema, Query>,
  ): RouteBuilder<
    Api,
    Method,
    Path,
    Schema,
    Body,
    Query,
    Output,
    Permission,
    Middleware,
    Access,
    Door
  > {
    assertSourceUnset("params", this.state.params);
    assertPathParameters(this.path, schema);
    assertDistinctSources(schema, this.state.input);
    assertDistinctSources(schema, this.state.query);

    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      params: schema,
    });
  }

  withInput<Schema extends SourceSchema>(
    this: RouteBuilder<
      Api,
      Exclude<HttpMethod, "get" | "head">,
      Path,
      Params,
      Body,
      Query,
      Output,
      Permission,
      Middleware,
      Access,
      Door
    >,
    schema: Schema & DistinctSchema<Schema, Params> & DistinctSchema<Schema, Query>,
  ): RouteBuilder<
    Api,
    Exclude<HttpMethod, "get" | "head">,
    Path,
    Params,
    Schema,
    Query,
    Output,
    Permission,
    Middleware,
    Access,
    Door
  > {
    assertBodyMethod(this.method, this.path);
    assertSourceUnset("input", this.state.input);
    assertParsedBodyFree({ operation: this.operation, state: this.state });
    assertDistinctSources(this.state.params, schema);
    assertDistinctSources(this.state.query, schema);

    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      input: schema,
    });
  }

  /**
   * The body is the evidence, so nothing parses it: the handler is handed the
   * exact characters or bytes it was sent, read once, beside its validated path
   * and query input. The declared body cap still runs first.
   */
  withRawBody<Form extends RestRawBodyForm>(
    this: RouteBuilder<
      Api,
      Exclude<HttpMethod, "get" | "head">,
      Path,
      Params,
      Body,
      Query,
      Output,
      Permission,
      Middleware,
      Access,
      Door
    >,
    form: Form,
    options: Readonly<{ mediaType?: string }> = {},
  ): RouteBuilder<
    Api,
    Exclude<HttpMethod, "get" | "head">,
    Path,
    Params,
    RestRawBodyDeclared<Form>,
    Query,
    Output,
    Permission,
    Middleware,
    Access,
    Door
  > {
    assertBodyMethod(this.method, this.path);
    assertSourceUnset("rawBody", this.state.rawBody);
    assertParsedBodyFree({ operation: this.operation, state: this.state });

    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      rawBody: { form, mediaType: options.mediaType ?? DEFAULT_RAW_MEDIA_TYPE[form] },
    });
  }

  /**
   * The request carries files beside its fields, so one schema cannot describe
   * it: the fields are parsed and merged into the input as any other source is,
   * and each file part the route named is handed over beside it.
   */
  withMultipart<Fields extends z.ZodObject, const Files extends RestMultipartFiles>(
    this: RouteBuilder<
      Api,
      Exclude<HttpMethod, "get" | "head">,
      Path,
      Params,
      Body,
      Query,
      Output,
      Permission,
      Middleware,
      Access,
      Door
    >,
    multipart: Readonly<{ fields: Fields; files: Files }>,
  ): RouteBuilder<
    Api,
    Exclude<HttpMethod, "get" | "head">,
    Path,
    Params,
    RestMultipartDeclared<Fields, Files>,
    Query,
    Output,
    Permission,
    Middleware,
    Access,
    Door
  > {
    assertBodyMethod(this.method, this.path);
    assertSourceUnset("multipart", this.state.multipart);
    assertParsedBodyFree({ operation: this.operation, state: this.state });
    assertDeclaredFiles({ operation: this.operation, files: multipart.files });
    assertDistinctSources(this.state.params, multipart.fields);
    assertDistinctSources(this.state.query, multipart.fields);

    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      multipart: { fields: multipart.fields, files: multipart.files },
    });
  }

  /**
   * How often one caller may ask. The framework owns the key — this family,
   * this operation, this version and the principal the door resolved — so the
   * store the process supplies never decides who is being limited.
   */
  withRateLimit(
    policy: RestRateLimitPolicy = {},
  ): RouteBuilder<
    Api,
    Method,
    Path,
    Params,
    Body,
    Query,
    Output,
    Permission,
    Middleware,
    Access,
    Door
  > {
    assertSourceUnset("rateLimit", this.state.rateLimit);

    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      rateLimit: policy,
    });
  }

  /**
   * How long this route's answer stands, and the tag a family drops its own
   * entries under. Only the validated bytes are stored, so a route that writes
   * its own answer, or declares none, cannot be cached.
   */
  withCache(
    policy: RestCachePolicy,
  ): RouteBuilder<
    Api,
    Method,
    Path,
    Params,
    Body,
    Query,
    Output,
    Permission,
    Middleware,
    Access,
    Door
  > {
    assertSourceUnset("cache", this.state.cache);
    assertCachePolicy({ operation: this.operation, policy });

    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      cache: policy,
    });
  }

  withQuery<Schema extends z.ZodObject>(
    schema: Schema & DistinctSchema<Schema, Params> & DistinctSchema<Schema, Body>,
  ): RouteBuilder<
    Api,
    Method,
    Path,
    Params,
    Body,
    Schema,
    Output,
    Permission,
    Middleware,
    Access,
    Door
  > {
    assertSourceUnset("query", this.state.query);
    assertDistinctSources(this.state.params, schema);
    assertDistinctSources(this.state.input, schema);

    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      query: schema,
    });
  }

  /**
   * The permission this route demands, and where it is asked. `{ at: "route",
   * param }` asks it at the scope the route's own path names, for a family
   * whose credential is one tier wider than the resource it addresses.
   */
  withPermission(
    permission: AuthzPermission,
    target?: RestPermissionTarget,
  ): RouteBuilder<
    Api,
    Method,
    Path,
    Params,
    Body,
    Query,
    Output,
    true,
    Middleware,
    Access,
    Door
  > {
    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      permission,
      ...(target ? { permissionTarget: target } : {}),
    });
  }

  /**
   * Declares how the route is reached instead of naming a permission:
   * `publicRoute` resolves no credential at all, so its handler is handed a
   * null actor and a null scope and the document publishes no security
   * requirement; `anyAuthenticated` still opens the family's own door.
   */
  withAccess<Kind extends RouteAccess>(
    access: Kind,
  ): RouteBuilder<
    Api,
    Method,
    Path,
    Params,
    Body,
    Query,
    Output,
    true,
    Middleware,
    Kind["kind"],
    Door
  > {
    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      access,
    });
  }

  withVersion(
    version: DateVersion,
  ): RouteBuilder<
    Api,
    Method,
    Path,
    Params,
    Body,
    Query,
    Output,
    Permission,
    Middleware,
    Access,
    Door
  > {
    assertVersionLabel(version);

    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      version,
    });
  }

  withDocs(
    docs: RestTransportDocs,
  ): RouteBuilder<
    Api,
    Method,
    Path,
    Params,
    Body,
    Query,
    Output,
    Permission,
    Middleware,
    Access,
    Door
  > {
    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      docs,
    });
  }

  /** Marks this one route superseded, whatever the family declared. */
  withDeprecated(
    deprecated: RestDeprecation,
  ): RouteBuilder<
    Api,
    Method,
    Path,
    Params,
    Body,
    Query,
    Output,
    Permission,
    Middleware,
    Access,
    Door
  > {
    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      deprecated,
    });
  }

  withOutput<Schema extends OutputSchema>(
    schema: Schema,
  ): RouteBuilder<
    Api,
    Method,
    Path,
    Params,
    Body,
    Query,
    Schema,
    Permission,
    Middleware,
    Access,
    Door
  > {
    assertSourceUnset("output", this.state.output ?? this.state.answers);
    assertSchemaAnswerFree({ operation: this.operation, state: this.state });

    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      output: schema,
    });
  }

  /**
   * The several answers this route may give, each with the body it carries:
   * `responds({ 200: report, 503: report })`. An unhealthy platform report is
   * an answer, not a failure, so the handler returns `{ status, body }` typed
   * by this declaration and the document lists every status.
   */
  responds<const Answers extends RestRouteAnswers>(
    answers: Answers,
  ): RouteBuilder<
    Api,
    Method,
    Path,
    Params,
    Body,
    Query,
    Answers,
    Permission,
    Middleware,
    Access,
    Door
  > {
    assertSourceUnset("output", this.state.output ?? this.state.answers);
    assertSchemaAnswerFree({ operation: this.operation, state: this.state });
    assertDeclaredAnswers({ operation: this.operation, answers });

    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      answers,
    });
  }

  /**
   * The route writes its own body, so no schema describes it: the handler
   * returns `{ status, headers, body }` or a whole `Response` it is
   * forwarding, and the document publishes the media types it names.
   */
  withRawResponse(
    options: Readonly<{ produces: string | readonly string[] }>,
  ): RouteBuilder<
    Api,
    Method,
    Path,
    Params,
    Body,
    Query,
    RestRawAnswerDeclared,
    Permission,
    Middleware,
    Access,
    Door
  > {
    assertSourceUnset("rawResponse", this.state.rawResponse);
    assertSchemaAnswerFree({ operation: this.operation, state: this.state });

    const produces = typeof options.produces === "string" ? [options.produces] : options.produces;

    assertProduces({ operation: this.operation, produces });

    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      rawResponse: { produces: [...produces] },
    });
  }

  /**
   * Every method this one declaration answers. `["GET", "HEAD"]` is the twin a
   * reader publishes: Hono answers HEAD from the GET route, and the runtime
   * drops the body it would have written rather than leaving the stream open.
   */
  methods(
    names: readonly RestMethodName[],
  ): RouteBuilder<
    Api,
    Method,
    Path,
    Params,
    Body,
    Query,
    Output,
    Permission,
    Middleware,
    Access,
    Door
  > {
    const methods = names.map((name) => name.toLowerCase() as HttpMethod);

    assertSourceUnset("methods", this.state.methods);
    assertDeclaredMethods({ operation: this.operation, method: this.method, methods });

    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      methods,
    });
  }

  /**
   * One path, whatever method arrives: an alias that rewrites and forwards, a
   * handshake whose own library terminates the request. It publishes no
   * operation, because it has none to publish, and writes its own answer.
   */
  anyMethod(): RouteBuilder<
    Api,
    Method,
    Path,
    Params,
    Body,
    Query,
    Output,
    Permission,
    Middleware,
    Access,
    Door
  > {
    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      anyMethod: true,
    });
  }

  handle<TResult extends RouteResult<Output>>(
    this: RouteReady<Path, Params, Permission> extends true
      ? RouteBuilder<
          Api,
          Method,
          Path,
          Params,
          Body,
          Query,
          Output,
          Permission,
          Middleware,
          Access,
          Door
        >
      : never,
    handler: (
      args: HandlerArgumentsFor<Access, RouteInput<Params, Query, Body>, Api, Door> &
        RawBodyArguments<Body> &
        MultipartArguments<Body> &
        RawResponseArguments<Output>,
      ...facts: MiddlewareFacts<Middleware>
    ) => TResult,
  ): RestTransportRouter<Api, Door> {
    assertRouteReady({
      method: this.method,
      path: this.path,
      operation: this.operation,
      state: this.state,
    });

    this.router.assertRouteAvailable(
      this.state.methods ?? [this.method],
      this.path,
      this.operation,
    );

    this.router.routes.push({
      method: this.method,
      path: this.path,
      operation: this.operation,
      version: this.state.version ?? this.router.version,
      ...(this.state.docs ? { docs: this.state.docs } : {}),
      ...(this.state.params ? { params: this.state.params } : {}),
      ...(this.state.input ? { input: this.state.input } : {}),
      ...(this.state.query ? { query: this.state.query } : {}),
      ...(this.state.access
        ? { access: this.state.access }
        : {
            permission: permissionOf(this.state.permission),
            ...(this.state.permissionTarget
              ? { permissionTarget: this.state.permissionTarget }
              : {}),
          }),
      output: this.state.output ?? successAnswerOf(this.state.answers) ?? z.void(),
      ...declaredParts(this.state),
      methods: this.state.methods ?? [this.method],
      ...(this.state.anyMethod ? { anyMethod: true } : {}),
      ...(this.state.status === void 0 ? {} : { status: this.state.status }),
      ...(this.state.middleware ? { middleware: this.state.middleware } : {}),
      ...(this.state.bodyLimit ? { bodyLimit: this.state.bodyLimit } : {}),
      ...(this.state.deprecated ? { deprecated: this.state.deprecated } : {}),
      handler: handler as ErasedHandler,
    });

    return this.router;
  }

  withStatus(
    status: ContentfulStatusCode,
  ): RouteBuilder<
    Api,
    Method,
    Path,
    Params,
    Body,
    Query,
    Output,
    Permission,
    Middleware,
    Access,
    Door
  > {
    if (!Number.isInteger(status) || status < 200 || status > 299) {
      throw new Error(
        "REST JSON success status must be 200–299 except 204; omit output for no content",
      );
    }

    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      status,
    });
  }

  withBodyLimit(
    limit: Readonly<{ maxBytes: number; onExceeded(): Error }>,
  ): RouteBuilder<
    Api,
    Method,
    Path,
    Params,
    Body,
    Query,
    Output,
    Permission,
    Middleware,
    Access,
    Door
  > {
    if (!Number.isSafeInteger(limit.maxBytes) || limit.maxBytes < 0)
      throw new Error("REST body limit must be a non-negative safe integer");

    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      bodyLimit: limit,
    });
  }

  withMiddleware<const Added extends readonly RestTransportMiddleware[]>(
    ...middleware: Added
  ): RouteBuilder<
    Api,
    Method,
    Path,
    Params,
    Body,
    Query,
    Output,
    Permission,
    [...Middleware, ...Added],
    Access,
    Door
  > {
    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      middleware: [...(this.state.middleware ?? []), ...middleware],
    });
  }
}

/**
 * What the route declared about its body, its answer and its two capabilities,
 * as the fields a declared route carries: present exactly when declared.
 */
function declaredParts(state: RouteState): Partial<RestTransportRoute<unknown>> {
  return {
    ...(state.answers ? { answers: state.answers } : {}),
    ...(state.rawBody ? { rawBody: state.rawBody } : {}),
    ...(state.multipart ? { multipart: state.multipart } : {}),
    ...(state.rateLimit ? { rateLimit: state.rateLimit } : {}),
    ...(state.cache ? { cache: state.cache } : {}),
    ...(state.rawResponse ? { rawResponse: state.rawResponse } : {}),
  };
}

/** A route just opened on a family's door: nothing declared but its address. */
type OpenRoute<
  Api,
  Method extends HttpMethod,
  Path extends string,
  Door extends RestDoorCredential,
> = RouteBuilder<Api, Method, Path, Missing, Missing, Missing, Missing, false, [], "scoped", Door>;

class RestTransportRouter<Api, Door extends RestDoorCredential = "projectKey"> {
  readonly routes: RestTransportRoute<Api>[] = [];
  private addressing: RestAddressing = "dated";
  private v1Twin = true;
  private generation = DEFAULT_GENERATION;
  private deprecated: RestDeprecation | undefined;

  constructor(
    private readonly api: FeatureApiWitness<Api>,
    readonly namespace: string,
    readonly version: DateVersion,
    readonly credential: Door,
  ) {}

  /**
   * The door this family's routes answer behind. Declared before the first
   * route, because it decides the scope every handler is handed: a route
   * declared under it reads `scope.tier` as the credential's own tier.
   */
  withCredential<NewDoor extends RestDoorCredential>(
    credential: NewDoor,
  ): RestTransportRouter<Api, NewDoor> {
    if (this.routes.length > 0) {
      throw new Error(`REST "${this.namespace}" must declare its credential before its routes`);
    }

    const router = new RestTransportRouter<Api, NewDoor>(
      this.api,
      this.namespace,
      this.version,
      credential,
    );

    router.addressing = this.addressing;
    router.v1Twin = this.v1Twin;
    router.generation = this.generation;
    router.deprecated = this.deprecated;

    return router;
  }

  /**
   * How the family is addressed. Declared before the first route, because it
   * decides which paths every route in the family answers at, and what it may
   * say about its twin and its generation.
   */
  withAddressing(
    addressing: RestAddressing,
    options: RestAddressingOptions = {},
  ): RestTransportRouter<Api, Door> {
    if (this.routes.length > 0) {
      throw new Error(`REST "${this.namespace}" must declare its addressing before its routes`);
    }

    assertAddressingOptions({ namespace: this.namespace, addressing, options });

    this.addressing = addressing;
    this.v1Twin = options.v1Twin ?? true;
    this.generation = options.generation ?? DEFAULT_GENERATION;

    return this;
  }

  /** Marks every route of the family superseded by `successor`. */
  withDeprecated(deprecated: RestDeprecation): RestTransportRouter<Api, Door> {
    this.deprecated = deprecated;

    return this;
  }

  /** The inert declaration a feature installer retains and a process mounts. */
  build(): Readonly<{
    protocol: "rest";
    namespace: string;
    router: () => RestTransportDeclaration<Api>;
  }> {
    const declaration: RestTransportDeclaration<Api> = {
      protocol: "rest",
      api: this.api,
      namespace: this.namespace,
      version: this.version,
      addressing: this.addressing,
      v1Twin: this.v1Twin,
      generation: this.generation,
      credential: this.credential,
      ...(this.deprecated ? { deprecated: this.deprecated } : {}),
      routes: this.routes,
    };

    return { protocol: "rest", namespace: this.namespace, router: () => declaration };
  }

  get<Path extends string>(path: Path, operation: string): OpenRoute<Api, "get", Path, Door> {
    assertSupportedPath({ path, addressing: this.addressing, namespace: this.namespace });

    return new RouteBuilder(this, "get", path, operation);
  }

  patch<Path extends string>(path: Path, operation: string): OpenRoute<Api, "patch", Path, Door> {
    assertSupportedPath({ path, addressing: this.addressing, namespace: this.namespace });

    return new RouteBuilder(this, "patch", path, operation);
  }

  post<Path extends string>(path: Path, operation: string): OpenRoute<Api, "post", Path, Door> {
    assertSupportedPath({ path, addressing: this.addressing, namespace: this.namespace });

    return new RouteBuilder(this, "post", path, operation);
  }

  put<Path extends string>(path: Path, operation: string): OpenRoute<Api, "put", Path, Door> {
    assertSupportedPath({ path, addressing: this.addressing, namespace: this.namespace });

    return new RouteBuilder(this, "put", path, operation);
  }

  delete<Path extends string>(path: Path, operation: string): OpenRoute<Api, "delete", Path, Door> {
    assertSupportedPath({ path, addressing: this.addressing, namespace: this.namespace });

    return new RouteBuilder(this, "delete", path, operation);
  }

  assertRouteAvailable(methods: readonly HttpMethod[], path: string, operation: string): void {
    const taken = this.routes
      .filter((route) => route.path === path)
      .flatMap((route) => route.methods ?? [route.method]);

    const clash = methods.find((method) => taken.includes(method));

    if (clash) {
      throw new Error(`REST ${clash.toUpperCase()} ${path} is already registered`);
    }

    if (this.routes.some((route) => route.operation === operation)) {
      throw new Error(`REST operation "${operation}" is already registered`);
    }
  }
}

/**
 * Opens a feature's REST surface. Each route is one complete declaration —
 * method, path, sources, permission, answer and documentation — because REST
 * shares no declaration with a browser client the way tRPC does.
 */
export function defineRestRouter<Api>(api: FeatureApiWitness<Api>) {
  return {
    /** The family's own path segment: the routes answer under `/api/<namespace>`. */
    withNamespace(namespace: string) {
      assertNamespace(namespace);

      return {
        withVersion(version: DateVersion): RestTransportRouter<Api, "projectKey"> {
          assertVersionLabel(version);

          return new RestTransportRouter<Api, "projectKey">(
            api,
            namespace,
            version,
            "projectKey",
          );
        },
      };
    },
  };
}

function assertNamespace(namespace: string): void {
  if (!/^[a-z][a-z0-9-]*$/.test(namespace)) {
    throw new Error(`REST namespace "${namespace}" must be lower kebab case`);
  }
}

function assertPathParameters(path: string, schema: z.ZodObject): void {
  const expected = [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]!);
  const actual = Object.keys(schema.shape);

  if (expected.length !== actual.length || expected.some((name) => !actual.includes(name))) {
    throw new Error(`REST path "${path}" parameters must exactly match withParams()`);
  }
}

function assertSupportedPath({
  path,
  addressing,
  namespace,
}: {
  path: string;
  addressing: RestAddressing;
  namespace: string;
}): void {
  if (/:[A-Za-z0-9_]+[?+*]/.test(path)) {
    throw new Error(`REST path "${path}" uses unsupported optional or repeated parameters`);
  }

  if (addressing !== "literal") return;

  // A literal family owns no prefix, so its routes ARE their addresses. A path
  // of one segment is the relative one a namespaced family would have written,
  // and here it would hang the route off the root of the process.
  const segments = path.split("/").filter((segment) => segment.length > 0);

  if (!path.startsWith("/") || segments.length < 2) {
    throw new Error(
      `REST "${namespace}" publishes its paths literally, so "${path}" must be the whole ` +
        "address it answers at, from the root",
    );
  }
}

/** The generation a family names in its own path, when it names one: `v2`. */
const DEFAULT_GENERATION = "v1";

/** What each addressing lets a family say about its own addresses. */
function assertAddressingOptions({
  namespace,
  addressing,
  options,
}: {
  namespace: string;
  addressing: RestAddressing;
  options: RestAddressingOptions;
}): void {
  const twinless = addressing === "v1-only" || addressing === "v1-in-path";

  if (options.v1Twin !== void 0 && twinless) {
    throw new Error(
      `REST "${namespace}" addresses itself "${addressing}", which names its ` +
        "generation in the path and so has no /api/v1 twin to declare",
    );
  }

  if (options.generation === void 0) return;

  if (addressing !== "v1-in-path") {
    throw new Error(
      `REST "${namespace}" addresses itself "${addressing}", which names no generation ` +
        "in its own path",
    );
  }

  if (!VERSION_SEGMENT.test(options.generation)) {
    throw new Error(
      `REST "${namespace}" names the generation "${options.generation}" in its path; a ` +
        "generation is spelled v1, v2 and so on",
    );
  }
}

function assertDistinctSources(
  left: SourceSchema | undefined,
  right: SourceSchema | undefined,
): void {
  if (!left || !right) return;

  const rightKeys = new Set(sourceKeys(right));
  const duplicate = sourceKeys(left).find((key) => rightKeys.has(key));

  if (duplicate) {
    throw new Error(`REST input field "${duplicate}" is declared by multiple sources`);
  }
}

function sourceKeys(schema: SourceSchema): string[] {
  return schema instanceof z.ZodObject
    ? Object.keys(schema.shape)
    : schema.options.flatMap((option) => Object.keys(option.shape));
}

function assertSourceUnset(source: string, schema: unknown): void {
  if (schema !== void 0) {
    throw new Error(
      `REST route already declared with${source[0]!.toUpperCase()}${source.slice(1)}()`,
    );
  }
}

function assertBodyMethod(method: HttpMethod, path: string): void {
  if (method === "get" || method === "head") {
    throw new Error(`REST ${method.toUpperCase()} ${path} cannot declare a JSON body`);
  }
}

function assertRouteReady({
  method,
  path,
  operation,
  state,
}: {
  method: HttpMethod;
  path: string;
  operation: string;
  state: RouteState;
}): void {
  if (!state.permission && !state.access) {
    throw new Error(`REST ${operation} must declare withPermission() or withAccess()`);
  }

  if (state.permission && state.access) {
    throw new Error(`REST ${operation} declares both a permission and ${state.access.kind} access`);
  }

  if (state.access?.kind === "public") assertNoScopeInput({ operation, state });

  if (state.answers && state.status !== void 0) {
    throw new Error(`REST ${operation} declares responds(), so its status is the answer's own`);
  }

  if (state.permissionTarget) assertPermissionTarget({ operation, state });

  if (state.anyMethod && !state.rawResponse) {
    throw new Error(
      `REST ${operation} answers every method, and no one schema describes what each of them ` +
        "answers with; it must declare withRawResponse()",
    );
  }

  if (state.anyMethod && state.methods) {
    throw new Error(`REST ${operation} answers every method and also names some of them`);
  }

  assertMethodsCarryTheirBody({ operation, state });
  assertCacheableAnswer({ operation, state });

  if (/:([A-Za-z0-9_]+)/.test(path) && !state.params) {
    throw new Error(`REST ${method.toUpperCase()} ${path} must declare withParams()`);
  }
}

/**
 * A body is read once, so exactly one declaration describes it: a JSON schema,
 * the exact bytes, or the fields and files of a multipart form.
 */
function assertParsedBodyFree({
  operation,
  state,
}: {
  operation: string;
  state: RouteState;
}): void {
  if (!state.input && !state.rawBody && !state.multipart) return;

  throw new Error(`REST ${operation} declares its body twice; the body is read once`);
}

/** Only validated bytes are stored, so a route with no answer has none to store. */
function assertCacheableAnswer({
  operation,
  state,
}: {
  operation: string;
  state: RouteState;
}): void {
  if (!state.cache || state.output || state.answers) return;

  throw new Error(
    `REST ${operation} declares a cache and no answer of its own; only validated bytes are ` +
      "stored, and there are none to store",
  );
}

/** What a cached route says about its entries: a real life, and a written tag. */
function assertCachePolicy({
  operation,
  policy,
}: {
  operation: string;
  policy: RestCachePolicy;
}): void {
  if (!Number.isSafeInteger(policy.ttlSeconds) || policy.ttlSeconds <= 0) {
    throw new Error(`REST ${operation} declares a cache whose entries live no time at all`);
  }

  if (policy.tag.trim() === "") {
    throw new Error(`REST ${operation} declares a cache under no tag, so nothing can drop it`);
  }
}

/** The file parts a multipart route names: at least one, each of them written. */
function assertDeclaredFiles({
  operation,
  files,
}: {
  operation: string;
  files: RestMultipartFiles;
}): void {
  const names = Object.keys(files);

  if (names.length === 0) {
    throw new Error(`REST ${operation} reads a multipart body and names no file part in it`);
  }

  const blank = names.find((name) => name.trim() === "");

  if (blank !== undefined) {
    throw new Error(`REST ${operation} names a file part with a blank field name`);
  }
}

/** A route answers with a schema or with its own bytes, never with both. */
function assertSchemaAnswerFree({
  operation,
  state,
}: {
  operation: string;
  state: RouteState;
}): void {
  const schema = state.output ?? state.answers;

  if (!schema && !state.rawResponse) return;

  throw new Error(
    `REST ${operation} declares both an output schema and a raw response; it answers one way`,
  );
}

/** The media types a raw answer publishes: at least one, each of them written. */
function assertProduces({
  operation,
  produces,
}: {
  operation: string;
  produces: readonly string[];
}): void {
  const named = produces.filter((mediaType) => mediaType.trim() !== "");

  if (named.length === produces.length && named.length > 0) return;

  throw new Error(`REST ${operation} writes its own body and names no media type it produces`);
}

/** Every method a declaration names: real, distinct, and its own among them. */
function assertDeclaredMethods({
  operation,
  method,
  methods,
}: {
  operation: string;
  method: HttpMethod;
  methods: readonly HttpMethod[];
}): void {
  if (methods.length === 0) {
    throw new Error(`REST ${operation} named no method to answer`);
  }

  if (new Set(methods).size !== methods.length) {
    throw new Error(`REST ${operation} names the same method twice`);
  }

  if (!methods.includes(method)) {
    throw new Error(
      `REST ${operation} answers ${methods.map((name) => name.toUpperCase()).join(", ")} and was ` +
        `declared as ${method.toUpperCase()}, which is not among them`,
    );
  }
}

/**
 * A body only reaches a method that carries one: naming GET or HEAD beside a
 * declared body would type a handler for a request that can never carry it, and
 * an any-method route cannot know which method arrived before it is parsed.
 */
function assertMethodsCarryTheirBody({
  operation,
  state,
}: {
  operation: string;
  state: RouteState;
}): void {
  if (!state.input && !state.rawBody && !state.multipart) return;

  if (state.anyMethod) {
    throw new Error(`REST ${operation} answers every method, and a body reaches only some of them`);
  }

  const bodyless = (state.methods ?? []).filter(isBodylessMethod);

  if (bodyless.length === 0) return;

  throw new Error(
    `REST ${operation} declares a body and answers ` +
      `${bodyless.map((name) => name.toUpperCase()).join(", ")}, which carries none`,
  );
}

function isBodylessMethod(method: HttpMethod): boolean {
  return method === "get" || method === "head";
}

/** The media type a raw body publishes when the route names none of its own. */
const DEFAULT_RAW_MEDIA_TYPE = {
  text: "text/plain",
  bytes: "application/octet-stream",
} as const satisfies Record<RestRawBodyForm, string>;

/**
 * A route checked at the scope its own path names has to parse that scope: the
 * parameter is a field of the route's own input, not a value the runtime could
 * find anywhere else.
 */
function assertPermissionTarget({
  operation,
  state,
}: {
  operation: string;
  state: Readonly<{
    params?: z.ZodObject;
    query?: z.ZodObject;
    input?: SourceSchema;
    permissionTarget?: RestPermissionTarget;
  }>;
}): void {
  const param = state.permissionTarget!.param;

  const declared = [state.params, state.query, state.input]
    .filter((schema): schema is SourceSchema => schema !== void 0)
    .flatMap((schema) => sourceKeys(schema));

  if (!declared.includes(param)) {
    throw new Error(
      `REST ${operation} checks its permission at the scope "${param}" names, and declares no ` +
        `source that parses "${param}"`,
    );
  }
}

/**
 * The several answers a route declared: at least one, and one success — or the
 * two an upsert gives, which say only whether the resource was created, and so
 * must carry the very same body.
 */
function assertDeclaredAnswers({
  operation,
  answers,
}: {
  operation: string;
  answers: RestRouteAnswers;
}): void {
  const statuses = Object.keys(answers).map(Number);

  if (statuses.length === 0) {
    throw new Error(`REST ${operation} declared responds() with no answers`);
  }

  const servable = statuses.every(isServableStatus);

  if (!servable) {
    throw new Error(`REST ${operation} declared an answer outside 200–599`);
  }

  const successes = statuses.filter((status) => status < 300);

  if (successes.length === 0 || successes.length > 2) {
    throw new Error(`REST ${operation} must declare one or two 2xx answers in responds()`);
  }

  if (successes.length === 2 && answers[successes[0]!] !== answers[successes[1]!]) {
    throw new Error(
      `REST ${operation} declares two successes carrying different bodies; two are for one ` +
        "answer whose status says only whether it created what it returned",
    );
  }
}

/** A status a handler may answer with: a real response class, not a redirect. */
function isServableStatus(status: number): boolean {
  return Number.isInteger(status) && status >= 200 && status <= 599;
}

/** The one 2xx of a `responds` map: what the route answers when it worked. */
function successAnswerOf(answers: RestRouteAnswers | undefined): OutputSchema | undefined {
  if (!answers) return undefined;

  for (const [status, schema] of Object.entries(answers)) {
    if (Number(status) < 300) return schema;
  }

  return undefined;
}

/**
 * A public route answers before any scope is resolved, so a scope field in its
 * own input would be a tenant the request names and nothing checks.
 */
function assertNoScopeInput({
  operation,
  state,
}: {
  operation: string;
  state: Readonly<{ params?: z.ZodObject; query?: z.ZodObject; input?: SourceSchema }>;
}): void {
  const declared = [state.params, state.query, state.input]
    .filter((schema): schema is SourceSchema => schema !== void 0)
    .flatMap((schema) => sourceKeys(schema));

  const named = SCOPE_INPUT_FIELDS.find((field) => declared.includes(field));

  if (named) {
    throw new Error(
      `REST ${operation} answers without a credential, so it cannot take "${named}" as input`,
    );
  }
}

function permissionOf(permission: AuthzPermission | undefined): AuthzPermission {
  if (!permission) throw new Error("REST route must declare withPermission()");

  return permission;
}

// ─────────────────────────────────────────────────────────────────────────────
// The one REST execution path: parse, authenticate, decide, handle, check the
// answer, respond. The request is parsed BEFORE the credential is resolved, so
// a malformed body is refused without ever touching the caller's key.
//
// A route answers at three addresses — its dated namespace, `latest`, and the
// family's bare path — plus the `/api/v1` twin of each, and any real date the
// caller pins dispatches to the latest registration on or before it.
// ─────────────────────────────────────────────────────────────────────────────

const ROUTE_PARAMS = "routeParams" as const;
const VERSION_REQUEST = "apiVersionRequest" as const;
const ROUTE_INPUT = "endpointInput" as const;
const ROUTE_RAW_BODY = "endpointRawBody" as const;
const ROUTE_FORM_FIELDS = "endpointFormFields" as const;
const ROUTE_FILES = "endpointFiles" as const;

/** Who the family's own door authenticated, and what its credential resolved. */
export type RestCaller = Readonly<{
  actor: Actor | null;
  /** Null exactly on a door whose credential names no tenant. */
  scope: AuthzDeclaredScopeId | null;
  /** What a deployment-secret door resolved; absent on every tenant door. */
  internal?: RestResolvedInternalCredential;
  /** Called only after the handler answered, for a credential that records use. */
  markUsed?: () => void;
}>;

/** Everything the process supplies for the path to run. */
export type RestRuntimePorts = Readonly<{
  identity: Readonly<{
    authenticate(input: {
      request: Request;
      permission: AuthzPermission;
    }): Promise<RestCaller> | RestCaller;
    /**
     * The family's own door, opened with no permission asked of it. Only a
     * declaration carrying an `anyAuthenticated` route needs it, and a mount
     * that supplies none is refused by name.
     */
    identify?(input: { request: Request }): Promise<RestCaller> | RestCaller;
    /**
     * The same door, opened for a caller who may have presented nothing: it
     * answers `null` for a request carrying no credential at all, and refuses
     * one carrying a credential it will not accept.
     */
    identifyOptional?(input: {
      request: Request;
    }): Promise<RestCaller | null> | RestCaller | null;
    /**
     * Whether the caller holds `permission` at the scope a route's own path
     * named. Only a declaration carrying such a route needs it, and a mount
     * that supplies none is refused by name.
     */
    authorize?(input: {
      caller: RestCaller;
      permission: AuthzPermission;
      target: AuthzDeclaredScopeId;
    }): Promise<PermissionDecision> | PermissionDecision;
  }>;
  /** Only a family whose routes carry a check of their own supplies these. */
  authorization?: Readonly<{ forRequest(request: Request): AuthorizePort }>;
  /** The counter behind every route that declared how often one caller may ask. */
  rateLimiter?: RateLimiter;
  /** The store behind every route that declared how long its answer stands. */
  cache?: ResponseCache;
  denials?: AccessDenialPort;
  /** Where the first call of each deprecated route is recorded. */
  deprecationLog?: RestDeprecationLogPort;
}>;

/**
 * Told once per process the first time a deprecated route is called, so an
 * operator learns a superseded endpoint is still in use without a line per
 * request. Defaults to doing nothing.
 */
export type RestDeprecationLogPort = Readonly<{
  deprecatedRouteCalled(input: {
    family: string;
    operation: string;
    successor: string;
    notice: string;
  }): void;
}>;

/** What one family's mount states beyond its declaration. */
export type RestMountOptions<Api> = Readonly<{
  app: () => Api;
  /**
   * Which credential reaches these routes, as the document names it. The
   * declaration names its own door; this states the one class no door resolves
   * a scope for — `public` — and naming a door credential that disagrees with
   * the declaration's is refused at mount.
   */
  credential?: Credential;
  /** The family's own error boundary: it renders every refusal these routes raise. */
  onError: ErrorHandler;
  /** Applied under the family's paths before any route: the app container. */
  middleware?: readonly MiddlewareHandler[];
  /**
   * One binding per fact the declaration's routes name. A declared fact with
   * no binding here is refused at mount rather than reaching a handler unset.
   */
  facts?: readonly RestTransportMiddlewareBinding[];
  /** Why the door, rather than a middleware chain, is what enforces the route. */
  reason?: string;
}>;

/** Mounts declared REST families on one process's own doors. */
export interface RestRuntime {
  mount<Api>(declaration: RestTransportDeclaration<Api>, options: RestMountOptions<Api>): HonoApp;
}

const HOST_ENFORCED = "project credential and permission enforced by the transport host";

/** Builds one process's REST path. */
export function createRestRuntime(ports: RestRuntimePorts): RestRuntime {
  return {
    mount: (declaration, options) => {
      const dated = declaration.addressing === "dated";
      const basePath = basePathOf(declaration);
      const app = new Hono();
      const scopes = middlewareScopesOf(declaration);
      const facts = factBindings({ declaration, options });
      const credential = mountCredential({ declaration, options });

      assertPortsBound({ declaration, ports });

      for (const middleware of [
        tracerMiddleware({ name: declaration.namespace }),
        loggerMiddleware({ name: declaration.namespace }),
        ...(options.middleware ?? []),
      ]) {
        for (const scope of scopes) app.use(scope, middleware);
      }

      const served = new Map<string, Set<HttpMethod>>();

      for (const route of declaration.routes) {
        for (const mount of addressesOf({ route, declaration })) {
          mountRoute({
            app,
            basePath,
            route,
            path: mount.path,
            v1Twin: declaration.v1Twin,
            stack: routeStack({
              route,
              declaration,
              ports,
              options,
              facts,
              ...mount.context,
            }),
            policy: registryPolicy({ route, options, credential }),
            credentialClass:
              route.access?.kind === "public" ? "none" : CREDENTIAL_CLASS[credential],
            family: declaration.namespace,
            served,
          });
        }
      }

      mountMethodGuards({ app, served });

      if (dated) mountVersionGuards({ app, basePath, declaration, ports, options, facts });
      app.onError(options.onError);

      return app;
    },
  };
}

/** Where the family's routes hang, by the way it addresses itself. */
function basePathOf(declaration: RestTransportDeclaration<unknown>): string {
  switch (declaration.addressing) {
    case "v1-only":
      return `${V1_PREFIX}/${declaration.namespace}`;
    case "v1-in-path":
      return `/api/${declaration.namespace}/${declaration.generation}`;
    case "dated":
      return `/api/${declaration.namespace}`;
    // A family sharing a prefix owns none of it: each route's own path is the
    // whole address, so there is no base to hang them off.
    case "literal":
      return "";
  }
}

/**
 * Where the family's own middleware applies. A family owning a prefix claims
 * it whole; a literal family claims exactly the addresses it declares, because
 * a wildcard would run ahead of a sibling family sharing the prefix.
 */
function middlewareScopesOf(declaration: RestTransportDeclaration<unknown>): string[] {
  const basePath = basePathOf(declaration);

  if (declaration.addressing !== "literal") {
    const aliasPath = declaration.v1Twin ? canonicalV1Path(basePath) : null;

    return aliasPath ? [`${basePath}/*`, `${aliasPath}/*`] : [`${basePath}/*`];
  }

  const scopes = new Set<string>();

  for (const route of declaration.routes) {
    scopes.add(route.path);

    const alias = declaration.v1Twin ? canonicalV1Path(route.path) : null;

    if (alias) scopes.add(alias);
  }

  return [...scopes];
}

/**
 * Every optional port the declaration's routes ask for, checked once at mount.
 * A route whose check the process cannot run is refused here, by name, rather
 * than at the first request that reaches it.
 */
function assertPortsBound<Api>({
  declaration,
  ports,
}: {
  declaration: RestTransportDeclaration<Api>;
  ports: RestRuntimePorts;
}): void {
  const base = basePathOf(declaration);

  for (const route of declaration.routes) {
    const address = `${route.method.toUpperCase()} ${base}${route.path}`;

    if (route.permissionTarget && !ports.identity.authorize) {
      throw new Error(
        `REST ${address} checks "${route.permission}" at the scope its path names, and this ` +
          "runtime supplied no identity.authorize",
      );
    }

    const identified = route.access?.kind === "authenticated" || route.access?.kind === "deferred";

    if (identified && !ports.identity.identify) {
      throw new Error(
        `REST ${address} answers behind the family's door with no permission, and this runtime ` +
          "supplied no identity.identify",
      );
    }

    assertCapabilityPorts({ address, route, ports });

    if (route.access?.kind === "optional" && !ports.identity.identifyOptional) {
      throw new Error(
        `REST ${address} answers with or without the family's credential, and this runtime ` +
          "supplied no identity.identifyOptional",
      );
    }
  }
}

/** The store behind each capability a route declared, named when it is missing. */
function assertCapabilityPorts({
  address,
  route,
  ports,
}: {
  address: string;
  route: RestTransportRoute<unknown>;
  ports: RestRuntimePorts;
}): void {
  if (route.rateLimit && !ports.rateLimiter) {
    throw new Error(
      `REST ${address} declares how often one caller may ask, and this runtime supplied no ` +
        "rateLimiter port to count with",
    );
  }

  if (route.cache && !ports.cache) {
    throw new Error(
      `REST ${address} declares how long its answer stands, and this runtime supplied no ` +
        "cache port to store it in",
    );
  }
}

/**
 * Every binding the declaration's facts need, checked once at mount. A fact
 * the mount did not bind is refused here, naming the fact and the route,
 * rather than reaching a handler as an unset argument.
 */
function factBindings<Api>({
  declaration,
  options,
}: {
  declaration: RestTransportDeclaration<Api>;
  options: RestMountOptions<Api>;
}): ReadonlyMap<string, RestTransportMiddlewareBinding> {
  const bound = new Map(
    (options.facts ?? []).map((binding) => [binding.middleware.name, binding] as const),
  );

  for (const route of declaration.routes) {
    for (const fact of route.middleware ?? []) {
      if (bound.has(fact.name)) continue;

      throw new Error(
        `REST ${route.method.toUpperCase()} /api/${declaration.namespace}${route.path} declares ` +
          `the fact "${fact.name}", and this mount bound no value for it`,
      );
    }
  }

  return bound;
}

/** The addresses one route answers at, and what each one reports. */
function addressesOf({
  route,
  declaration,
}: {
  route: RestTransportRoute<unknown>;
  declaration: RestTransportDeclaration<unknown>;
}): readonly {
  path: string;
  context: { version: string; status: VersionStatus; suffix?: string };
}[] {
  const version = declaration.version;
  // A collection route's path is the family root, so it contributes nothing to
  // an address: concatenating it would date the namespace as `/<version>/`,
  // which no caller sends and a sibling `/:id` answers instead.
  const suffix = route.path === "/" ? "" : route.path;

  // A family that names its generation in the path has that generation as its
  // whole contract, and a literal family's route path IS its address: one
  // address either way, no dated namespace, no latest alias, and nothing for a
  // date to fall back to.
  if (declaration.addressing !== "dated") {
    return [{ path: suffix || "/", context: { version, status: "stable" } }];
  }

  return [
    { path: `/${version}${suffix}`, context: { version, status: "stable", suffix: dated(version) } },
    {
      path: `/${VERSION_LATEST}${suffix}`,
      context: { version: VERSION_LATEST, status: "latest", suffix: VERSION_LATEST },
    },
    { path: suffix || "/", context: { version: VERSION_LATEST, status: "latest" } },
  ];
}

function dated(version: string): string {
  return version.replaceAll("-", "_");
}

/**
 * The whole stack for one mount of one route: the version headers, the
 * document block, the validators, the merged input and the handler.
 */
function routeStack<Api>({
  route,
  declaration,
  ports,
  options,
  facts,
  version,
  status,
  suffix,
  paramSource = "route",
  documented = true,
}: {
  route: RestTransportRoute<Api>;
  declaration: RestTransportDeclaration<Api>;
  ports: RestRuntimePorts;
  options: RestMountOptions<Api>;
  facts: ReadonlyMap<string, RestTransportMiddlewareBinding>;
  version: string;
  status: VersionStatus;
  suffix?: string | undefined;
  paramSource?: "route" | "context";
  documented?: boolean;
}): MiddlewareHandler[] {
  const limit = route.bodyLimit;
  const family = declaration.namespace;
  const deprecated = route.deprecated ?? declaration.deprecated;
  // An any-method route publishes no operation, because it has none: one
  // handler stands behind every method the path can be sent. A family behind a
  // browser session publishes none either — no API client can present a
  // cookie, so an advertised operation would be one nothing can call.
  const publishable = route.anyMethod !== true && declaration.credential !== "session";
  const documents = documented && publishable;

  return [
    versionContext({ route, family, version, status }),
    ...(documents
      ? [
          documentRoute({
            route,
            suffix,
            credential: declaration.credential,
            ...(deprecated ? { deprecated } : {}),
          }),
        ]
      : []),
    // Ahead of everything that can refuse: a deprecated endpoint's answer says
    // so whether it succeeded or not.
    ...(deprecated
      ? [deprecatedAlias(deprecated), deprecationLog({ route, family, deprecated, ports })]
      : []),
    // Ahead of the validators: they read the body to parse it, and a stream
    // read once cannot be drained again to measure it.
    ...(limit
      ? [
          bodyLimit({
            maxSize: limit.maxBytes,
            onError: () => {
              throw limit.onExceeded();
            },
          }),
        ]
      : []),
    // After the cap and before the validators, which never see a raw body: the
    // bytes are read once, exactly as they were sent.
    ...(route.rawBody ? [rawBodyMiddleware(route.rawBody)] : []),
    ...(route.multipart
      ? [
          multipartMiddleware({
            multipart: route.multipart,
            fieldsKey: ROUTE_FORM_FIELDS,
            filesKey: ROUTE_FILES,
          }),
        ]
      : []),
    ...validators({ route, documented: documents, paramSource }),
    inputMiddleware({ route, paramSource }),
    handlerMiddleware({
      route,
      credential: declaration.credential,
      ports,
      options,
      facts,
      family,
      version,
    }),
  ];
}

/** The exact characters or bytes a route that parses nothing was sent. */
function rawBodyMiddleware(rawBody: RestRawBody): MiddlewareHandler {
  return async (context, next) => {
    const bytes = new Uint8Array(await context.req.raw.arrayBuffer());

    context.set(ROUTE_RAW_BODY, rawBody.form === "text" ? TEXT.decode(bytes) : bytes);
    await next();
  };
}

const TEXT = new TextDecoder();

/** Every deprecated route is reported once per process, on its first call. */
const reportedDeprecations = new Set<string>();

function deprecationLog<Api>({
  route,
  family,
  deprecated,
  ports,
}: {
  route: RestTransportRoute<Api>;
  family: string;
  deprecated: RestDeprecation;
  ports: RestRuntimePorts;
}): MiddlewareHandler {
  const key = `${family} ${route.operation}`;

  return async (context, next) => {
    if (!reportedDeprecations.has(key)) {
      reportedDeprecations.add(key);
      ports.deprecationLog?.deprecatedRouteCalled({
        family,
        operation: route.operation,
        successor: deprecated.successor,
        notice: deprecationNotice(deprecated),
      });
    }

    await next();
  };
}

/**
 * The route's own identity on the request, and the version headers every
 * answer carries — set in a `finally` so a refusal carries them too.
 */
function versionContext({
  route,
  family,
  version,
  status,
}: {
  route: RestTransportRoute<unknown>;
  family: string;
  version: string;
  status: VersionStatus;
}): MiddlewareHandler {
  // Built once per mount: the registered path and method cannot change after.
  const identity = `${route.method.toUpperCase()} ${route.path || "/"}`;

  return async (context, next) => {
    context.set(ENDPOINT_ROUTE, identity);
    context.set(REQUEST_FAMILY, family);

    try {
      await next();
    } finally {
      // The fallback serves an unregistered date with the effective version's
      // stack: the header names the namespace that was asked for.
      const answered = (context.get(VERSION_REQUEST) as string | undefined) ?? version;
      context.header("X-API-Version", answered);
      context.header("X-API-Version-Status", status);
    }
  };
}

/**
 * One validator per declared source. hono-openapi's validator carries the
 * OpenAPI metadata the document is generated from, so an undocumented mount
 * keeps the validation and drops the metadata: validation is not documentation.
 */
function validators({
  route,
  documented,
  paramSource,
}: {
  route: RestTransportRoute<unknown>;
  documented: boolean;
  paramSource: "route" | "context";
}): MiddlewareHandler[] {
  const stack: MiddlewareHandler[] = [];

  const add = (target: "param" | "query" | "json", schema: z.ZodType | undefined): void => {
    if (!schema) return;

    const middleware = openApiValidator(target, schema, (result) => {
      // The typed refusal, raised here rather than left for a boundary to
      // recognise: a family with an `onError` of its own must not answer 500
      // for a request every other family answers 422 for.
      if (!result.success) {
        throw requestValidationErrorFrom({ target, error: result.error, input: result.data });
      }
    });

    if (!documented) {
      delete (middleware as Partial<Record<typeof uniqueSymbol, unknown>>)[uniqueSymbol];
    }

    stack.push(middleware);
  };

  if (route.params && paramSource === "context") {
    // The date fallback matched the path itself, so Hono's route params belong
    // to the guard rather than to the endpoint.
    const schema = route.params;

    stack.push(async (context, next) => {
      const named = (context.get(ROUTE_PARAMS) as Record<string, string> | undefined) ?? {};
      const parsed = schema.safeParse(named);

      if (!parsed.success) {
        throw requestValidationErrorFrom({ target: "param", error: parsed.error, input: named });
      }

      context.set("params", parsed.data);
      await next();
    });
  } else {
    add("param", route.params);
  }

  add("query", route.query);
  add("json", route.input);

  return stack;
}

/** The one validated handler input: path, query and body fields, flattened. */
function inputMiddleware({
  route,
  paramSource,
}: {
  route: RestTransportRoute<unknown>;
  paramSource: "route" | "context";
}): MiddlewareHandler {
  return async (context, next) => {
    const matched =
      paramSource === "route" ? context.req.valid("param" as never) : context.get("params");

    const params = route.params ? matched : undefined;

    const query = route.query ? context.req.valid("query" as never) : undefined;
    const json = route.input ? context.req.valid("json" as never) : undefined;
    const body = route.multipart ? context.get(ROUTE_FORM_FIELDS) : json;

    context.set(ROUTE_INPUT, mergeInput({ params, query, body }));
    await next();
  };
}

function mergeInput({
  params,
  query,
  body,
}: {
  params: unknown;
  query: unknown;
  body: unknown;
}): Record<string, unknown> | undefined {
  if (params === undefined && query === undefined && body === undefined) return undefined;

  const input: Record<string, unknown> = {};

  for (const [source, part] of [
    ["path", params],
    ["query", query],
    ["body", body],
  ] as const) {
    if (part === undefined) continue;

    if (part === null || typeof part !== "object" || Array.isArray(part)) {
      throw new TypeError(`REST ${source} schemas must produce an object`);
    }

    for (const [key, value] of Object.entries(part)) {
      if (Object.hasOwn(input, key)) {
        throw new TypeError(`REST input field "${key}" is declared by multiple sources`);
      }

      input[key] = value;
    }
  }

  return input;
}

/** Authenticate, decide, handle, check the answer, respond. */
function handlerMiddleware<Api>({
  route,
  credential,
  ports,
  options,
  facts,
  family,
  version,
}: {
  route: RestTransportRoute<Api>;
  credential: RestDoorCredential;
  ports: RestRuntimePorts;
  options: RestMountOptions<Api>;
  facts: ReadonlyMap<string, RestTransportMiddlewareBinding>;
  family: string;
  version: string;
}): MiddlewareHandler {
  return async (context, next) => {
    const input = context.get(ROUTE_INPUT);

    // A public route resolves nothing: no credential is read, no scope is
    // established, and the handler is told so rather than handed a guess.
    if (route.access?.kind === "public") {
      const result = await route.handler(
        handlerArguments({
          context,
          route,
          options,
          input,
          actor: null,
          scope: null,
          target: null,
        }),
        ...(await resolveFacts({ route, facts, context })),
      );

      return answerWith({ context, next, route, result });
    }

    const permission = route.access ? void 0 : permissionOf(route.permission);
    const caller = await callerOf({ route, ports, request: context.req.raw });

    // An optional door the caller presented nothing at: the handler is told
    // there is no one behind the request rather than handed a guess.
    if (!caller) {
      const anonymous = await route.handler(
        handlerArguments({ context, route, options, input, actor: null, scope: null, target: null }),
        ...(await resolveFacts({ route, facts, context })),
      );

      return answerWith({ context, next, route, result: anonymous });
    }

    const decision = await decide({
      declaration: {
        kind: "service-authorized",
        reason: route.access?.reason ?? options.reason ?? HOST_ENFORCED,
        permissions: permission === void 0 ? [] : [permission],
      },
      caller: { actor: normalizedActor(caller.actor), scope: caller.scope },
      input,
      ...(ports.authorization
        ? { authorize: ports.authorization.forRequest(context.req.raw) }
        : {}),
      ...(ports.denials ? { denials: ports.denials } : {}),
    });

    const target = await checkRouteScope({ route, caller, ports, input });
    const capabilities = { route, ports, context, family, version, caller, input } as const;

    await countCall(capabilities);

    // After the door, never before it: a caller who may not read this cannot
    // be handed the bytes an entitled one left behind.
    const stored = await storedAnswer(capabilities);

    if (stored) return stored;

    const result = await route.handler(
      handlerArguments({
        context,
        route,
        options,
        input,
        actor: doorActorOf({ credential, actor: decision.actor }),
        scope: handlerScopeOf({ route, credential, caller }),
        target,
      }),
      ...(await resolveFacts({ route, facts, context })),
    );

    caller.markUsed?.();

    const answer = await answerWith({ context, next, route, result });

    return keepAnswer({ ...capabilities, answer });
  };
}

/** The logger both capabilities report a store's own failure through. */
const capabilityLogger = createLogger("langwatch:api:endpoint-capabilities");

/**
 * The call, counted. The key is the framework's — this family, this operation,
 * this version, this principal — and a caller past the limit is refused with
 * the wait the counter named, before the handler is reached.
 */
async function countCall({
  route,
  ports,
  context,
  family,
  version,
  caller,
}: {
  route: RestTransportRoute<unknown>;
  ports: RestRuntimePorts;
  context: Context;
  family: string;
  version: string;
  caller: RestCaller;
}): Promise<void> {
  if (!route.rateLimit || !ports.rateLimiter) return;

  const key = restRateLimitKey({
    family: route.rateLimit.bucket ?? family,
    operation: route.operation,
    version,
    principal: principalOf(caller),
  });

  const verdict = await ports.rateLimiter.check(key);

  if (verdict.allowed) return;

  if (verdict.retryAfterSeconds !== undefined) {
    context.header("Retry-After", String(verdict.retryAfterSeconds));
  }

  throw new RateLimitedError();
}

/** Who the counter counts: the scope the door resolved, or the caller itself. */
function principalOf(caller: RestCaller): string {
  if (caller.scope) return caller.scope.id;

  const actor = normalizedActor(caller.actor);

  return actor?.id ?? caller.internal?.secretName ?? "anonymous";
}

/** The bytes an identical call left behind, served without the handler. */
async function storedAnswer({
  route,
  ports,
  context,
  family,
  version,
  input,
}: {
  route: RestTransportRoute<unknown>;
  ports: RestRuntimePorts;
  context: Context;
  family: string;
  version: string;
  input: unknown;
}): Promise<Response | undefined> {
  if (!route.cache || !ports.cache) return undefined;

  const body = await cachedRestAnswer({
    cache: ports.cache,
    key: restCacheKey({ family, operation: route.operation, version, input }),
    logger: capabilityLogger,
  });

  if (!body) return undefined;

  context.header("Content-Type", "application/json");

  return context.body(body as never, (route.status ?? 200) as ContentfulStatusCode);
}

/** The same store, written with the bytes this call answered. */
async function keepAnswer({
  route,
  ports,
  family,
  version,
  input,
  answer,
}: {
  route: RestTransportRoute<unknown>;
  ports: RestRuntimePorts;
  family: string;
  version: string;
  input: unknown;
  answer: Response | undefined;
}): Promise<Response | undefined> {
  if (!route.cache || !ports.cache || !answer?.ok) return answer;

  await storeRestAnswer({
    cache: ports.cache,
    key: restCacheKey({ family, operation: route.operation, version, input }),
    policy: route.cache,
    body: new Uint8Array(await answer.clone().arrayBuffer()),
    logger: capabilityLogger,
  });

  return answer;
}

/** What every handler is called with, whichever door let the request in. */
function handlerArguments<Api>({
  context,
  route,
  options,
  input,
  actor,
  scope,
  target,
}: {
  context: Context;
  route: RestTransportRoute<Api>;
  options: RestMountOptions<Api>;
  input: unknown;
  actor: Actor | null;
  scope: AuthzDeclaredScopeId | null;
  target: AuthzDeclaredScopeId | null;
}): StoredHandlerArguments<Api> {
  return {
    app: options.app(),
    input,
    actor,
    scope,
    target,
    signal: context.req.raw.signal,
    request: context.req.raw,
    raw: route.rawBody ? (context.get(ROUTE_RAW_BODY) as string | Uint8Array) : undefined,
    files: route.multipart
      ? (context.get(ROUTE_FILES) as Readonly<Record<string, File>>)
      : undefined,
  };
}

/**
 * The answer: the declared schema's, the route's own bytes, or — from an
 * any-method route that recognised nothing of its own — none at all, so
 * whatever is mounted after this family routes the request as it always did.
 */
async function answerWith<Api>({
  context,
  next,
  route,
  result,
}: {
  context: Context;
  next: () => Promise<void>;
  route: RestTransportRoute<Api>;
  result: unknown;
}): Promise<Response | undefined> {
  if (!route.rawResponse) return respond({ context, route, result });

  if (!isDeclined(result)) return respondRaw({ context, route, result });

  if (!route.anyMethod) {
    throw new Error(
      `REST ${route.operation} declined a request it was matched by method and path; only an ` +
        "any-method route, which matched neither, may decline",
    );
  }

  await next();

  return undefined;
}

/**
 * The permission a route asks at the scope its own path named, and the target
 * it was asked about. Null for every route checked at the credential's scope.
 */
async function checkRouteScope({
  route,
  caller,
  ports,
  input,
}: {
  route: RestTransportRoute<unknown>;
  caller: RestCaller;
  ports: RestRuntimePorts;
  input: unknown;
}): Promise<AuthzDeclaredScopeId | null> {
  if (!route.permissionTarget) return null;

  const permission = permissionOf(route.permission);
  const target = routeScopeOf({ param: route.permissionTarget.param, input });

  const decision = await requireAuthorize(ports)({ caller, permission, target });

  assertRouteScopePermission({
    permission,
    target,
    decision,
    ...(ports.denials ? { denials: ports.denials } : {}),
  });

  return target;
}

/**
 * Which question this route's access kind asks of the family's door: the
 * permission the route named, the door alone, or the door for a caller who may
 * have presented nothing — the one question that can answer with nobody.
 */
async function callerOf({
  route,
  ports,
  request,
}: {
  route: RestTransportRoute<unknown>;
  ports: RestRuntimePorts;
  request: Request;
}): Promise<RestCaller | null> {
  const kind = route.access?.kind;

  if (kind === "optional") return requireIdentifyOptional(ports)({ request });

  if (kind === "authenticated" || kind === "deferred") return requireIdentify(ports)({ request });

  return ports.identity.authenticate({ request, permission: permissionOf(route.permission) });
}

/**
 * The scope the handler reads. A deferred route is handed none on purpose: the
 * resource names its own owner, and resolving it is the handler's own work.
 */
function handlerScopeOf({
  route,
  credential,
  caller,
}: {
  route: RestTransportRoute<unknown>;
  credential: RestDoorCredential;
  caller: RestCaller;
}): AuthzDeclaredScopeId | null {
  if (route.access?.kind === "deferred") return null;

  return doorScopeOf({ credential, caller });
}

/** @see assertPortsBound, which refuses these before a request arrives. */
function requireIdentifyOptional(
  ports: RestRuntimePorts,
): NonNullable<RestRuntimePorts["identity"]["identifyOptional"]> {
  const identifyOptional = ports.identity.identifyOptional;

  if (!identifyOptional) throw new Error("REST runtime supplied no identity.identifyOptional");

  return identifyOptional.bind(ports.identity);
}

/** @see assertPortsBound, which refuses these before a request arrives. */
function requireIdentify(
  ports: RestRuntimePorts,
): NonNullable<RestRuntimePorts["identity"]["identify"]> {
  const identify = ports.identity.identify;

  if (!identify) throw new Error("REST runtime supplied no identity.identify");

  return identify.bind(ports.identity);
}

/** @see assertPortsBound, which refuses these before a request arrives. */
function requireAuthorize(
  ports: RestRuntimePorts,
): NonNullable<RestRuntimePorts["identity"]["authorize"]> {
  const authorize = ports.identity.authorize;

  if (!authorize) throw new Error("REST runtime supplied no identity.authorize");

  return authorize.bind(ports.identity);
}

/**
 * The declared facts, in declaration order, each parsed by the schema that
 * declared it. Resolved after the access decision, so a refused request never
 * asks the process for anything.
 */
async function resolveFacts({
  route,
  facts,
  context,
}: {
  route: RestTransportRoute<unknown>;
  facts: ReadonlyMap<string, RestTransportMiddlewareBinding>;
  context: Context;
}): Promise<unknown[]> {
  const resolved: unknown[] = [];

  for (const fact of route.middleware ?? []) {
    const binding = facts.get(fact.name);

    if (!binding) {
      throw new Error(`REST ${route.operation} declares the fact "${fact.name}" and none is bound`);
    }

    resolved.push(fact.schema.parse(await binding.resolve(context)));
  }

  return resolved;
}

function normalizedActor(actor: Actor | null): (Actor & { id: string }) | null {
  if (!actor) return null;

  const parsed = actorSchema.parse(actor);

  return "id" in parsed && typeof parsed.id === "string"
    ? (parsed as Actor & { id: string })
    : null;
}

/**
 * The scope the declaration's door promised, or a refusal naming both tiers.
 *
 * A plain `Error`: a door that resolved another tier is mis-wired, and no
 * caller can act on it. The credential-class refusal a CALLER earns — a
 * project key at an organization family — is the door's own, thrown before
 * this is ever reached.
 */
function doorScopeOf({
  credential,
  caller,
}: {
  credential: RestDoorCredential;
  caller: RestCaller;
}) {
  const tier = DOOR_SCOPE_TIER[credential];
  const scope = caller.scope;

  // A deployment's own secret names no tenant, so the door has to prove it
  // resolved none — and, for the shared secret, to name which one let the
  // request in. The instance administrator's key names itself.
  if (tier === null) {
    const named = credential === "internalSecret" ? caller.internal !== undefined : true;

    if (scope !== null || !named) {
      throw new Error(
        `REST transport authorization established a tenant scope for a "${credential}" door, ` +
          "which names no tenant and must resolve a named deployment secret instead",
      );
    }

    return null;
  }

  if (scope === null || scope.tier !== tier) {
    throw new Error(
      `REST transport authorization established a "${scope?.tier ?? "null"}" scope for a ` +
        `"${credential}" door, which resolves a "${tier}" scope`,
    );
  }

  return scope;
}

/** A door that names no tenant identifies no person either. */
function doorActorOf({
  credential,
  actor,
}: {
  credential: RestDoorCredential;
  actor: Actor | null;
}): Actor | null {
  return DOOR_SCOPE_TIER[credential] === null ? null : actor;
}

/**
 * The declared answer. The success status is fixed at declaration rather than
 * read off what the handler returned, so one operation cannot answer 200 on
 * the request that found something and 204 on the one that did not.
 */
function respond({
  context,
  route,
  result,
}: {
  context: Context;
  route: RestTransportRoute<unknown>;
  result: unknown;
}): Response {
  if (route.answers) return respondDeclared({ context, route, answers: route.answers, result });

  const validation = route.output.safeParse(result);

  if (!validation.success) {
    outputLogger.error(
      {
        endpoint: context.get(ENDPOINT_ROUTE) ?? "<unregistered>",
        method: context.req.method,
        path: context.req.path,
        validation: validationMeta(validation.error, { privacy: "schema-only" }),
      },
      "REST handler response did not match its declared output schema",
    );

    return context.json(result as never, route.status ?? 200);
  }

  // Reachable only for a `z.void()` output: a route that declared no answer
  // always takes this branch, and every other route never does.
  if (validation.data === undefined) return context.body(null, route.status ?? 204);

  return context.json(validation.data as never, route.status ?? 200);
}

/**
 * The bytes a route wrote for itself, verbatim: its own `{ status, headers,
 * body }`, or a whole `Response` it is forwarding. Nothing is validated,
 * because the route declared that nothing describes it.
 */
function respondRaw({
  context,
  route,
  result,
}: {
  context: Context;
  route: RestTransportRoute<unknown>;
  result: unknown;
}): Response {
  if (result instanceof Response) return result;

  const answer = result as RestRawAnswer | null;

  if (!answer || typeof answer !== "object" || !("body" in answer)) {
    throw new Error(
      `REST ${route.operation} writes its own body, and answered with neither a Response nor ` +
        "{ status, headers, body }",
    );
  }

  const status = answer.status ?? 200;
  const headers = { ...answer.headers };

  // Hono answers HEAD from the GET route, so the twin's body is dropped here
  // rather than left for a garbage collector to close.
  if (context.req.method === "HEAD") {
    if (answer.body instanceof ReadableStream) void answer.body.cancel();

    return context.body(null, status, headers);
  }

  return context.body(answer.body as never, status, headers);
}

/**
 * One of the several answers a route declared. The status comes from the
 * handler, but only the declared ones are servable — an undeclared status is a
 * plain `Error`, because no caller can act on a route answering off-contract.
 */
function respondDeclared({
  context,
  route,
  answers,
  result,
}: {
  context: Context;
  route: RestTransportRoute<unknown>;
  answers: RestRouteAnswers;
  result: unknown;
}): Response {
  const answer = result as { status?: unknown; body?: unknown };
  const status = typeof answer?.status === "number" ? answer.status : undefined;
  const schema = status === undefined ? undefined : answers[status];

  if (!schema || status === undefined) {
    throw new Error(
      `REST ${route.operation} answered with the status ${String(status)}, which it did not ` +
        `declare; responds() named ${Object.keys(answers).join(", ")}`,
    );
  }

  const validation = schema.safeParse(answer.body);

  // The declared status IS the answer, whatever its class, so the request
  // record reads as one rather than as a server fault.
  context.set(DECLARED_ANSWER, true);

  if (!validation.success) {
    outputLogger.error(
      {
        endpoint: context.get(ENDPOINT_ROUTE) ?? "<unregistered>",
        method: context.req.method,
        path: context.req.path,
        status,
        validation: validationMeta(validation.error, { privacy: "schema-only" }),
      },
      "REST handler response did not match the answer its declaration named",
    );

    return context.json(answer.body as never, status as ContentfulStatusCode);
  }

  return context.json(validation.data as never, status as ContentfulStatusCode);
}

/**
 * The version namespace: any real date the caller pins dispatches to the
 * latest registration on or before it, and anything else that is not a
 * servable version answers 404 rather than falling through to a dynamic route.
 */
function mountVersionGuards<Api>({
  app,
  basePath,
  declaration,
  ports,
  options,
  facts,
}: {
  app: Hono;
  basePath: string;
  declaration: RestTransportDeclaration<Api>;
  ports: RestRuntimePorts;
  options: RestMountOptions<Api>;
  facts: ReadonlyMap<string, RestTransportMiddlewareBinding>;
}): void {
  const namespace = "/:apiVersion{latest|preview|20\\d{2}-\\d{2}-\\d{2}}";
  const fallback = dateFallback({ basePath, declaration, ports, options, facts });
  const notFound: MiddlewareHandler = async (context) => context.notFound();

  for (const guard of [namespace, `${namespace}/*`]) {
    const handlers: [MiddlewareHandler, ...MiddlewareHandler[]] = [fallback, notFound];
    const absolute = mergePath(basePath, guard);
    const alias = declaration.v1Twin ? canonicalV1Path(absolute) : null;

    app.all(absolute, ...handlers);
    if (alias) app.all(alias, ...handlers);

    registerRoutePolicy({
      method: "all",
      path: absolute,
      ...(alias ? { canonicalPath: alias } : {}),
      policy: publicEndpoint(
        "version-namespace guard: answers 404 for unknown version segments " +
          "so they cannot fall through to a dynamic route; " +
          "reads no data and takes no credential",
      ),
      family: declaration.namespace,
      credentialClass: "none",
      isNamespaceGuard: true,
    });
  }
}

/** Serves an unregistered but real date with the effective version's stack. */
function dateFallback<Api>({
  basePath,
  declaration,
  ports,
  options,
  facts,
}: {
  basePath: string;
  declaration: RestTransportDeclaration<Api>;
  ports: RestRuntimePorts;
  options: RestMountOptions<Api>;
  facts: ReadonlyMap<string, RestTransportMiddlewareBinding>;
}): MiddlewareHandler {
  const candidates = declaration.routes.map((route) => ({
    methods: route.methods ?? [route.method],
    anyMethod: route.anyMethod === true,
    pattern: route.path || "/",
    stack: routeStack({
      route,
      declaration,
      ports,
      options,
      facts,
      version: declaration.version,
      status: "stable",
      paramSource: "context",
      documented: false,
    }),
  }));

  return async (context, next) => {
    const requested = context.req.param("apiVersion") ?? "";

    if (!isDateVersion(requested) || requested < declaration.version) return next();

    // The guard is mounted under both prefixes, so the base to strip comes
    // from the route that matched rather than from the family's bare path.
    const marker = context.req.routePath.indexOf("/:apiVersion");
    const mountBase = marker >= 0 ? context.req.routePath.slice(0, marker) : basePath;
    const rest = context.req.path.slice(mountBase.length + requested.length + 1) || "/";
    const method = context.req.method.toLowerCase() as HttpMethod;

    for (const candidate of candidates) {
      if (!serves(candidate, method)) continue;

      const params = matchPath(candidate.pattern, rest);

      if (!params) continue;

      context.set(ROUTE_PARAMS, params);
      context.set(VERSION_REQUEST, requested);

      const response = await runStack(candidate.stack, context);

      return response ?? next();
    }

    return next();
  };
}

/** Whether a candidate of the date fallback answers the method that arrived. */
function serves(
  candidate: Readonly<{ methods: readonly HttpMethod[]; anyMethod: boolean }>,
  method: HttpMethod,
): boolean {
  return candidate.anyMethod || candidate.methods.includes(method);
}

/**
 * Runs a mount's own stack outside Hono's router, for the date fallback, and
 * preserves short-circuiting. Assigning each response to the context mirrors
 * Hono and keeps headers written by an outer `finally` on the answer.
 */
async function runStack(
  stack: readonly MiddlewareHandler[],
  context: Context,
): Promise<Response | undefined> {
  let index = 0;

  const dispatch = async (): Promise<Response | undefined> => {
    const handler = stack[index++];

    if (!handler) return undefined;

    let inner: Response | undefined;

    const returned = await handler(context, async () => {
      inner = await dispatch();
    });

    const response = returned instanceof Response ? returned : inner;

    if (response) context.res = response;

    return response;
  };

  return dispatch();
}

/**
 * Matches a declared path against the request's remainder, extracting
 * `:params`. Literal segments and `:name` are all a declared route can carry.
 */
function matchPath(pattern: string, path: string): Record<string, string> | null {
  const expected = segmentsOf(pattern);
  const actual = segmentsOf(path);
  const params: Record<string, string> = {};

  if (expected.length !== actual.length) return null;

  for (const [index, segment] of expected.entries()) {
    const value = actual[index]!;

    if (segment.startsWith(":")) {
      params[segment.slice(1)] = decodeSegment(value);
      continue;
    }

    if (segment !== value) return null;
  }

  return params;
}

function segmentsOf(path: string): string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}

function decodeSegment(value: string): string {
  if (!value.includes("%")) return value;

  try {
    return decodeURIComponent(value);
  } catch {
    // Hono still decodes each valid percent run when another is malformed, so
    // the eager and fallback route params stay byte-for-byte equal.
    return value.replace(/(?:%[0-9A-Fa-f]{2})+/g, (encoded) => {
      try {
        return decodeURIComponent(encoded);
      } catch {
        return encoded;
      }
    });
  }
}

/**
 * One logical route at two addresses: its own, and the canonical `/api/v1`
 * twin, whose stack carries no document metadata so the operation is published
 * once.
 */
function mountRoute({
  app,
  basePath,
  route,
  path,
  v1Twin,
  stack,
  policy,
  credentialClass,
  family,
  served,
}: {
  app: Hono;
  basePath: string;
  route: RestTransportRoute<unknown>;
  path: string;
  v1Twin: boolean;
  stack: MiddlewareHandler[];
  policy: AccessPolicy;
  credentialClass: CredentialClass;
  family: string;
  served: Map<string, Set<HttpMethod>>;
}): void {
  // A literal family has no base to merge: its route path is the address.
  const absolute = basePath === "" ? path : mergePath(basePath, path);
  const alias = v1Twin ? canonicalV1Path(absolute) : null;
  const methods = route.methods ?? [route.method];
  const addresses = alias ? [absolute, alias] : [absolute];

  register({ app, route, methods, path: absolute, stack });

  if (alias) register({ app, route, methods, path: alias, stack: undescribedStack(stack) });

  for (const method of route.anyMethod ? ["all"] : methods) {
    registerRoutePolicy({
      method,
      path: absolute,
      ...(alias ? { canonicalPath: alias } : {}),
      policy,
      family,
      credentialClass,
    });
  }

  if (route.anyMethod) return;

  for (const address of addresses) {
    const known = served.get(address) ?? new Set<HttpMethod>();

    served.set(address, known);

    for (const method of methods) known.add(method);
  }
}

function register({
  app,
  route,
  methods,
  path,
  stack,
}: {
  app: Hono;
  route: RestTransportRoute<unknown>;
  methods: readonly HttpMethod[];
  path: string;
  stack: MiddlewareHandler[];
}): void {
  const handlers = stack as [MiddlewareHandler, ...MiddlewareHandler[]];

  if (route.anyMethod) {
    app.all(path, ...handlers);

    return;
  }

  for (const method of methods) {
    // Hono exposes no `.head` shortcut, and HEAD is answered from the GET route
    // before routing, so that registration is for the registry and the document.
    if (method === "head") app.on("HEAD", path, ...handlers);
    else app[method](path, ...handlers);
  }
}

/**
 * A path this family serves, asked for with a method it does not: 405 with the
 * `Allow` header naming what it does serve. Written here rather than thrown,
 * because `Allow` is the whole of the answer the router owes.
 */
function mountMethodGuards({
  app,
  served,
}: {
  app: Hono;
  served: ReadonlyMap<string, Set<HttpMethod>>;
}): void {
  for (const [path, methods] of served) {
    const allow = allowHeaderOf(methods);

    app.all(path, async (context, next) => {
      const asked = context.req.method.toLowerCase() as HttpMethod;

      if (methods.has(asked)) return next();

      context.header("Allow", allow);

      return context.body(null, 405);
    });
  }
}

/** What the path serves, as `Allow` spells it; HEAD rides on GET, as Hono serves it. */
function allowHeaderOf(methods: ReadonlySet<HttpMethod>): string {
  const named = new Set(methods);

  if (named.has("get")) named.add("head");

  return [...named]
    .map((method) => method.toUpperCase())
    .sort()
    .join(", ");
}

const HANDLER_CREDENTIAL = {
  projectKey: "apiKey",
  organizationKey: "apiKey",
  scimToken: "apiKey",
  instanceAdminKey: "apiKey",
  session: "session",
  internalSecret: "internal",
} as const satisfies Record<Exclude<Credential, "public">, HandlerCredential>;

/** Which security scheme a consumer of each credential presents. */
const CREDENTIAL_CLASS = {
  projectKey: "project_api_key",
  organizationKey: "organization_api_key",
  scimToken: "scim_token",
  instanceAdminKey: "instance_admin_api_key",
  session: "session",
  internalSecret: "internal_secret",
  public: "none",
} as const satisfies Record<Credential, CredentialClass>;

/**
 * What the route registry records: the door authenticates and enforces, so the
 * route is handler-managed, and the credential the mount named is what an API
 * consumer presents.
 */
function registryPolicy<Api>({
  route,
  options,
  credential,
}: {
  route: RestTransportRoute<Api>;
  options: RestMountOptions<Api>;
  credential: Credential;
}): AccessPolicy {
  const reason = options.reason ?? HOST_ENFORCED;

  if (route.access?.kind === "public") return publicEndpoint(route.access.reason);

  if (credential === "public") return publicEndpoint(reason);

  // A route the door alone gates enforces no RBAC permission, which is exactly
  // what the empty list on a handler-managed policy states.
  return handlerManagedAuth({
    reason: route.access?.reason ?? reason,
    credential: HANDLER_CREDENTIAL[credential],
    permissions: route.access ? [] : [permissionOf(route.permission)],
  });
}

/**
 * Which credential an API consumer presents at this mount. The declaration
 * names its door; the mount may only widen to a class no door resolves yet,
 * and a mount naming the OTHER door is refused here rather than serving an
 * organization family behind a project key.
 */
function mountCredential<Api>({
  declaration,
  options,
}: {
  declaration: RestTransportDeclaration<Api>;
  options: RestMountOptions<Api>;
}): Credential {
  const named = options.credential;

  if (named === void 0) return declaration.credential;

  if (named in DOOR_SCOPE_TIER && named !== declaration.credential) {
    throw new Error(
      `REST "${declaration.namespace}" declares the "${declaration.credential}" door and this ` +
        `mount names "${named}"; the declaration is what types its handlers' scope`,
    );
  }

  return named;
}
