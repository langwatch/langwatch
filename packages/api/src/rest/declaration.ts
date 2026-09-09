/**
 * `defineRestRouter`: one complete declaration per route, under a namespace and
 * a version — its sources, its answers, the door it is asked behind and the
 * handler that answers it — with the declaration-time asserts that refuse an
 * incoherent route where it is written rather than where it is mounted.
 */
import type { Actor } from "@langwatch/actor";
import type {
  AuthzDeclaredScopeId,
  AuthzPermission,
  ScopeTierField,
} from "@langwatch/authz-contract";
import type { FeatureApiToken } from "@langwatch/runtime-composition";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

import {
  SCOPE_INPUT_FIELDS,
  type ApiEntitlement,
  type Credential,
  type RouteAccess,
} from "../access/access.ts";
import type { ApiHandlerArguments } from "../handler-arguments.ts";
import {
  assertAddressingOptions,
  assertVersionLabel,
  DEFAULT_GENERATION,
  type DateVersion,
  type HttpMethod,
  type RestAddressing,
  type RestAddressingOptions,
} from "./addressing.ts";
import {
  defineRestMiddleware,
  type RestCachePolicy,
  type RestMultipart,
  type RestMultipartFiles,
  type RestRateLimitPolicy,
  type RestTransportMiddleware,
} from "./request.ts";
import type { RestIdempotency } from "./idempotency.ts";
import type { Declined, RouteResponse } from "./response.ts";

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
export const DOOR_SCOPE_TIER = {
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
export type StoredHandlerArguments<Api> = Readonly<{
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
type RawBodyArguments<Body extends RouteSource> =
  Body extends RestRawBodyDeclared<infer Form> ? Readonly<{ raw: RawBodyValue<Form> }> : unknown;

/**
 * The files a multipart route is handed, beside its input: each part it named,
 * present for certain when the declaration said the request must carry it.
 */
type MultipartArguments<Body extends RouteSource> =
  Body extends RestMultipartDeclared<z.ZodObject, infer Files>
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
  /** Present exactly when the route asks the tenant to hold an entitlement. */
  readonly entitlement?: ApiEntitlement;
  /** Present exactly when the route's create is replayable under a caller key. */
  readonly idempotency?: RestIdempotency;
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
  entitlement?: ApiEntitlement;
  idempotency?: RestIdempotency;
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

  /**
   * What the tenant behind the request must hold beside the permission. Asked
   * after access is decided, at the scope access resolved, so a caller who may
   * not do this at all is refused before the plan is ever looked up.
   */
  withEntitlement(
    entitlement: ApiEntitlement,
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
    assertSourceUnset("entitlement", this.state.entitlement);

    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      entitlement,
    });
  }

  /**
   * Makes this create safe to retry under a caller-chosen key. The tenancy the
   * key is unique within is the scope access resolved, never a callback, so a
   * route cannot key a create outside the door it answers behind.
   */
  withIdempotency(
    idempotency: RestIdempotency,
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
    assertSourceUnset("idempotency", this.state.idempotency);

    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      idempotency,
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
  ): RouteBuilder<Api, Method, Path, Params, Body, Query, Output, true, Middleware, Access, Door> {
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
    ...(state.entitlement ? { entitlement: state.entitlement } : {}),
    ...(state.idempotency ? { idempotency: state.idempotency } : {}),
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
  private root = false;
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
    router.root = this.root;
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
    this.root = options.root ?? false;
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
    assertSupportedPath({
      path,
      addressing: this.addressing,
      root: this.root,
      namespace: this.namespace,
    });

    return new RouteBuilder(this, "get", path, operation);
  }

  patch<Path extends string>(path: Path, operation: string): OpenRoute<Api, "patch", Path, Door> {
    assertSupportedPath({
      path,
      addressing: this.addressing,
      root: this.root,
      namespace: this.namespace,
    });

    return new RouteBuilder(this, "patch", path, operation);
  }

  post<Path extends string>(path: Path, operation: string): OpenRoute<Api, "post", Path, Door> {
    assertSupportedPath({
      path,
      addressing: this.addressing,
      root: this.root,
      namespace: this.namespace,
    });

    return new RouteBuilder(this, "post", path, operation);
  }

  put<Path extends string>(path: Path, operation: string): OpenRoute<Api, "put", Path, Door> {
    assertSupportedPath({
      path,
      addressing: this.addressing,
      root: this.root,
      namespace: this.namespace,
    });

    return new RouteBuilder(this, "put", path, operation);
  }

  delete<Path extends string>(path: Path, operation: string): OpenRoute<Api, "delete", Path, Door> {
    assertSupportedPath({
      path,
      addressing: this.addressing,
      root: this.root,
      namespace: this.namespace,
    });

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

          return new RestTransportRouter<Api, "projectKey">(api, namespace, version, "projectKey");
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
  root,
  namespace,
}: {
  path: string;
  addressing: RestAddressing;
  root: boolean;
  namespace: string;
}): void {
  if (/:[A-Za-z0-9_]+[?+*]/.test(path)) {
    throw new Error(`REST path "${path}" uses unsupported optional or repeated parameters`);
  }

  if (addressing !== "literal") return;

  // A literal family owns no prefix, so its routes ARE their addresses. A path
  // of one segment is the relative one a namespaced family would have written,
  // and here it would hang the route off the root of the process — which is
  // exactly what a family that declared `root` means to do.
  const segments = path.split("/").filter((segment) => segment.length > 0);
  const shortest = root ? 1 : 2;

  if (!path.startsWith("/") || segments.length < shortest) {
    throw new Error(
      `REST "${namespace}" publishes its paths literally, so "${path}" must be the whole ` +
        "address it answers at, from the root",
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

  // Both ask a question about a tenant, and a public route resolves none.
  if (state.access?.kind === "public" && state.entitlement) {
    throw new Error(
      `REST ${operation} answers without a credential, so there is no tenant to ask whether it ` +
        `holds "${state.entitlement}"`,
    );
  }

  if (state.access?.kind === "public" && state.idempotency) {
    throw new Error(
      `REST ${operation} answers without a credential, so there is no tenancy a caller's ` +
        "idempotency key is unique within",
    );
  }

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

export function permissionOf(permission: AuthzPermission | undefined): AuthzPermission {
  if (!permission) throw new Error("REST route must declare withPermission()");

  return permission;
}
