/**
 * `defineRestRouter`: one complete declaration per route — its sources, its
 * answers, the door it is asked behind and the handler that answers it — with
 * declaration-time asserts that refuse an incoherent route where it is written.
 */
import type { Actor } from "@langwatch/actor";
import type {
  AuthzDeclaredScopeId,
  AuthzPermission,
  ScopeTierField,
} from "@langwatch/authz-contract";
import type { ModuleApiToken } from "@langwatch/kernel";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type * as httpStatusModule from "hono/utils/http-status";
import { z } from "zod";

import {
  SCOPE_INPUT_FIELDS,
  type ApiEntitlement,
  type Credential,
  type RouteAccess,
} from "../access/access.ts";
import { PayloadTooLargeError } from "../errors.ts";
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
import type { RestIdempotency } from "./idempotency.ts";
import type { RestTransportDocs } from "./openapi.ts";
import {
  defineRestMiddleware,
  type RawBodyValue,
  type RestCachePolicy,
  type RestMultipart,
  type RestMultipartDeclared,
  type RestMultipartFiles,
  type RestRateLimitPolicy,
  type RestRawAnswerDeclared,
  type RestRawBody,
  type RestRawBodyDeclared,
  type RestRawBodyForm,
  type RestRawResponse,
  type RestRawResult,
  type RestTransportMiddleware,
} from "./request.ts";
import {
  defaultProducesFor,
  kindNeedsReason,
  type RestProducedFor,
  type RestProducerFor,
  type RestResponseDeclaration,
  type RestResponseDeclared,
  type RestResponseKind,
} from "./response-kind.ts";

// ─────────────────────────────────────────────────────────────────────────────
// `defineRestRouter`: one complete declaration per route, under a namespace and
// a version. REST shares no declaration with a browser client the way tRPC
// does, so each route states its whole identity here.
// ─────────────────────────────────────────────────────────────────────────────

/** The portable part of a feature API token; no kernel dependency. */
export type FeatureApiWitness<Api> = ModuleApiToken<Api>;

type SourceSchema = z.ZodObject | z.ZodDiscriminatedUnion<readonly z.ZodObject[]>;
type Missing = undefined;
type RouteSource = SourceSchema | RestRawBodyDeclared | RestMultipartDeclared | Missing;
/** `:id{.+?}` declares a Hono regex constraint; the parameter's name is the part before it. */
type StripParamConstraint<Segment extends string> = Segment extends `${infer Bare}{${string}}`
  ? Bare
  : Segment;
type PathParameterNames<Path extends string> = Path extends `${string}:${infer Tail}`
  ? Tail extends `${infer Name}/${infer Rest}`
    ? StripParamConstraint<Name> | PathParameterNames<`/${Rest}`>
    : StripParamConstraint<Tail>
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
 * answer with several shapes - a create that either found the object or started
 * an upload - and publishes as `oneOf` with its discriminator.
 */
type OutputSchema =
  | z.ZodObject
  | z.ZodArray
  | z.ZodVoid
  | z.ZodUndefined
  | z.ZodDiscriminatedUnion<readonly z.ZodObject[]>;

/**
 * What a project-scoped door knows about the caller beyond the request's own
 * input: the platform-URL slug, the person a personal view is filtered for,
 * and the actor an action is recorded against — named here so every family agrees.
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
 * purpose: nothing is resolved for it, so naming it would type a handler's
 * scope as a value no door establishes — use `publicRoute` access instead.
 */
export type RestDoorCredential = Extract<
  Credential,
  | "project"
  | "organization"
  | "apiKey"
  | "scimToken"
  | "internalSecret"
  | "instance-admin"
  | "browser"
>;

/**
 * Which scope tier each door's credential resolves — the one table both the
 * handler's type and the runtime's assert read, so a door can't promise one
 * tier and hand over another. `null` means no tenant (a deployment's own secret).
 */
export const DOOR_SCOPE_TIER = {
  project: "project",
  organization: "organization",
  apiKey: "organization",
  scimToken: "organization",
  browser: null,
  internalSecret: null,
  "instance-admin": null,
} as const satisfies Record<RestDoorCredential, AuthzDeclaredScopeId["tier"] | null>;

/** The scope a handler on `Door` is handed: the tier that door resolves. */
type DoorScope<Door extends RestDoorCredential> = (typeof DOOR_SCOPE_TIER)[Door] extends null
  ? null
  : Extract<AuthzDeclaredScopeId, { tier: (typeof DOOR_SCOPE_TIER)[Door] }>;
type ScopedHandlerArguments<Input, App, Door extends RestDoorCredential> = Omit<
  ApiHandlerArguments<Input, App>,
  "scope" | "actor"
> & {
  readonly actor: Door extends "browser" ? Extract<Actor, { type: "user" }> : Actor | null;
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
export type RouteAccessKind = "scoped" | "public" | "authenticated" | "optional" | "deferred";
/**
 * What a stored handler is invoked with, once the declaration's own types are
 * gone: every door's arguments widened to one shape. Real types are enforced
 * by `handle`; this is a method only so the parameter stays bivariant.
 */
export type StoredHandlerArguments<Api> = Readonly<{
  app: Api;
  input: unknown;
  actor: Actor | null;
  scope: AuthzDeclaredScopeId | null;
  target: AuthzDeclaredScopeId | null;
  signal: AbortSignal | undefined;
  /** Read once, only for a route that declared it; undefined everywhere else. */
  raw: string | Uint8Array | ReadableStream<Uint8Array> | null | undefined;
  /** The file parts a multipart route named; undefined everywhere else. */
  files: Readonly<Record<string, File>> | undefined;
  /** The producer for the kind a route declared; undefined everywhere else. */
  response: RestProducerFor<RestResponseKind> | undefined;
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

/** The methods a route may name, spelled the way HTTP spells them. */
export type RestMethodName = Uppercase<HttpMethod>;

/** The statuses a route declares answers for, each with the body it carries. */
export type RestRouteAnswers = Readonly<Record<number, OutputSchema>>;
export type RestDeclaredResult<Answers extends RestRouteAnswers> = {
  [Status in keyof Answers]: Readonly<{
    status: Status & httpStatusModule.StatusCode;
    headers?: Readonly<Record<string, string>>;
    body: z.input<Answers[Status] & OutputSchema>;
  }>;
}[keyof Answers];
type MaterialOutputKeys<Value> = {
  [Key in keyof Value]-?: Exclude<Value[Key], undefined> extends never ? never : Key;
}[keyof Value];
type OutputWithDeclaredKeys<Actual, Declared> =
  Exclude<MaterialOutputKeys<Actual>, keyof Declared> extends never ? Actual : never;
type ExactOutputMember<Actual, Declared> = Declared extends unknown
  ? Actual extends Declared
    ? Actual extends readonly unknown[]
      ? Actual
      : OutputWithDeclaredKeys<Actual, Declared>
    : never
  : never;
type ExactDeclaredOutput<Actual, Declared> = Actual extends unknown
  ? ExactOutputMember<Actual, Declared>
  : never;
type OutputResultCheck<Output extends RouteAnswer, Result> = Output extends OutputSchema
  ? [Awaited<Result>] extends [ExactDeclaredOutput<Awaited<Result>, z.infer<Output>>]
    ? unknown
    : never
  : unknown;
/**
 * What the handler returns: its own bytes, the one declared body, one
 * `{ status, body }` of the several a route declared, or nothing. The answer
 * slot holds exactly one of those, so a route states its answers in one place.
 */
type RouteResult<Output extends RouteAnswer> =
  Output extends RestResponseDeclared<infer Kind>
    ? RestProducedFor<Kind> | Promise<RestProducedFor<Kind>>
    : SerialisedRouteResult<Output>;
/** The answers the framework itself writes: its own bytes, one schema's, or several. */
type SerialisedRouteResult<Output extends RouteAnswer> = Output extends RestRawAnswerDeclared
  ? RestRawResult | Promise<RestRawResult>
  : Output extends OutputSchema
    ? z.infer<Output> | Promise<z.infer<Output>>
    : Output extends RestRouteAnswers
      ? RestDeclaredResult<Output> | Promise<RestDeclaredResult<Output>>
      : void | Promise<void>;
type RouteAnswer =
  | OutputSchema
  | RestRouteAnswers
  | RestRawAnswerDeclared
  | RestResponseDeclared
  | Missing;

/**
 * What a declared kind needs said about it: the media types a bytes or
 * protocol answer publishes, and the reason the two kinds that write a wire we
 * do not own are written at all.
 */
export type RestResponseOptions<
  Kind extends RestResponseKind,
  Produces extends string | readonly string[],
> = Readonly<{ produces?: Produces; because?: string }> &
  (Kind extends "bytes" | "protocol" ? Readonly<{ produces: Produces }> : unknown) &
  (Kind extends "protocol" | "forwarded" ? Readonly<{ because: string }> : unknown);

/** Those same options once the kind is gone: what the declaration reads off them. */
type DeclaredResponseOptions = Readonly<{
  produces?: string | readonly string[];
  because?: string;
}>;

function declaredProduces(options: DeclaredResponseOptions): readonly string[] | undefined {
  if (options.produces === undefined) return undefined;

  return typeof options.produces === "string" ? [options.produces] : options.produces;
}

function declaredReason(options: DeclaredResponseOptions): string | undefined {
  return options.because;
}

/**
 * The producer a declared kind hands the handler, beside its input, and the
 * request the two forwarding kinds read for themselves. A route with no
 * declared kind is handed no producer, so it has no way to write bytes.
 */
type ResponseArguments<Answer extends RouteAnswer> =
  Answer extends RestResponseDeclared<infer Kind, infer Produces>
    ? Readonly<{ response: RestProducerFor<Kind, Produces> }> &
        (Kind extends "protocol" | "forwarded" ? Readonly<{ request: Request }> : unknown)
    : unknown;

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
 * Where a route's permission is checked: `route` asks at the scope the route's
 * own path names (the project or team it addresses), not the one the
 * credential resolved. `param` is the field that tier is spelled with.
 */
export type RestPermissionTarget =
  | Readonly<{ at: "route"; param: ScopeTierField }>
  | Readonly<{ at: "header"; param: ScopeTierField; header: string }>;

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
  /** Present exactly when the route declared the kind of answer it gives. */
  readonly response?: RestResponseDeclaration;
  /** Every method this one declaration answers; the declared method alone by default. */
  readonly methods?: readonly HttpMethod[];
  /** True for the one route of a path that answers whatever method arrives. */
  readonly anyMethod?: boolean;
  readonly status?: ContentfulStatusCode;
  readonly middleware?: readonly RestTransportMiddleware[];
  readonly bodyLimit?: Readonly<{ maxBytes: number; onExceeded(): Error }>;
  readonly deprecated?: RestDeprecation;
  /** The door this ONE route answers behind; the family's own when absent. */
  readonly credential?: RestDoorCredential;
  /** Present exactly when the route declared the trail it leaves. */
  readonly audit?: string;
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
  /** Present exactly when the route declared the kind of answer it gives. */
  response?: RestResponseDeclaration;
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
  credential?: RestDoorCredential;
  audit?: string;
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
type HasJsonDeclarations<
  Body extends RouteSource,
  Output extends RouteAnswer,
> = Body extends SourceSchema
  ? Output extends OutputSchema | RestRouteAnswers
    ? true
    : false
  : false;
type JsonRouteExempt<
  Access extends RouteAccessKind,
  Output extends RouteAnswer,
> = Access extends "public"
  ? true
  : Output extends RestRawAnswerDeclared
    ? true
    : Output extends RestResponseDeclared
      ? true
      : false;
type JsonDeclarationsReady<
  Strict extends boolean,
  Body extends RouteSource,
  Output extends RouteAnswer,
  Access extends RouteAccessKind,
> = Strict extends true
  ? JsonRouteExempt<Access, Output> extends true
    ? true
    : HasJsonDeclarations<Body, Output>
  : true;

/**
 * Everything a half-declared route knows about itself, as one record. The
 * builder carries it as a single type parameter, so an option is a field here
 * and one return type on the method that sets it, not a line on all of them.
 */
type RouteShape = Readonly<{
  method: HttpMethod;
  path: string;
  params: RouteSource;
  body: RouteSource;
  query: RouteSource;
  /** What the route answers with: a schema, several, its own bytes, or nothing. */
  answer: RouteAnswer;
  /** Whether the route has said how it is reached - a permission or an access kind. */
  permission: boolean;
  middleware: readonly RestTransportMiddleware[];
  access: RouteAccessKind;
  /** The family's door, which a route may narrow to its own. */
  family: RestDoorCredential;
  door: RestDoorCredential;
  strict: boolean;
}>;

/** `S` with the fields `Changes` names replaced: one declaration, one move. */
type With<S extends RouteShape, Changes extends Partial<RouteShape>> = Readonly<{
  [Field in keyof RouteShape]: Field extends keyof Changes ? Changes[Field] : S[Field];
}>;

class RouteBuilder<Api, S extends RouteShape> {
  constructor(
    private readonly router: RestTransportRouter<Api, S["family"], S["strict"]>,
    private readonly method: S["method"],
    private readonly path: S["path"],
    private readonly operation: string,
    private readonly state: RouteState = {},
  ) {}

  withParams<Schema extends z.ZodObject>(
    schema: ExactPathSchema<S["path"], Schema> &
      DistinctSchema<Schema, S["body"]> &
      DistinctSchema<Schema, S["query"]>,
  ): RouteBuilder<Api, With<S, { params: Schema }>> {
    assertSourceUnset("params", this.state.params);
    assertPathParameters(this.path, schema);
    assertDistinctSources(schema, this.state.input);
    assertDistinctSources(schema, this.state.query);

    return new RouteBuilder<Api, With<S, { params: Schema }>>(
      this.router,
      this.method,
      this.path,
      this.operation,
      {
        ...this.state,
        params: schema,
      },
    );
  }

  withInput<Schema extends SourceSchema>(
    this: RouteBuilder<Api, With<S, { method: Exclude<HttpMethod, "get" | "head"> }>>,
    schema: Schema & DistinctSchema<Schema, S["params"]> & DistinctSchema<Schema, S["query"]>,
  ): RouteBuilder<Api, With<S, { method: Exclude<HttpMethod, "get" | "head">; body: Schema }>> {
    assertBodyMethod(this.method, this.path);
    assertSourceUnset("input", this.state.input);
    assertParsedBodyFree({ operation: this.operation, state: this.state });
    assertDistinctSources(this.state.params, schema);
    assertDistinctSources(this.state.query, schema);

    return new RouteBuilder<
      Api,
      With<S, { method: Exclude<HttpMethod, "get" | "head">; body: Schema }>
    >(this.router, this.method, this.path, this.operation, {
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
    this: RouteBuilder<Api, With<S, { method: Exclude<HttpMethod, "get" | "head"> }>>,
    form: Form,
    options: Readonly<{ mediaType?: string }> = {},
  ): RouteBuilder<
    Api,
    With<S, { method: Exclude<HttpMethod, "get" | "head">; body: RestRawBodyDeclared<Form> }>
  > {
    assertBodyMethod(this.method, this.path);
    assertSourceUnset("rawBody", this.state.rawBody);
    assertParsedBodyFree({ operation: this.operation, state: this.state });

    return new RouteBuilder<
      Api,
      With<S, { method: Exclude<HttpMethod, "get" | "head">; body: RestRawBodyDeclared<Form> }>
    >(this.router, this.method, this.path, this.operation, {
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
    this: RouteBuilder<Api, With<S, { method: Exclude<HttpMethod, "get" | "head"> }>>,
    multipart: Readonly<{ fields: Fields; files: Files }>,
  ): RouteBuilder<
    Api,
    With<
      S,
      { method: Exclude<HttpMethod, "get" | "head">; body: RestMultipartDeclared<Fields, Files> }
    >
  > {
    assertBodyMethod(this.method, this.path);
    assertSourceUnset("multipart", this.state.multipart);
    assertParsedBodyFree({ operation: this.operation, state: this.state });
    assertDeclaredFiles({ operation: this.operation, files: multipart.files });
    assertDistinctSources(this.state.params, multipart.fields);
    assertDistinctSources(this.state.query, multipart.fields);

    return new RouteBuilder<
      Api,
      With<
        S,
        { method: Exclude<HttpMethod, "get" | "head">; body: RestMultipartDeclared<Fields, Files> }
      >
    >(this.router, this.method, this.path, this.operation, {
      ...this.state,
      multipart: { fields: multipart.fields, files: multipart.files },
    });
  }

  /**
   * How often one caller may ask. The framework owns the key, so the store
   * never decides who is limited; a policy names its window whole or not at
   * all, since one number alone would miscount against the default.
   */
  withRateLimit(policy: RestRateLimitPolicy = {}): RouteBuilder<Api, S> {
    assertSourceUnset("rateLimit", this.state.rateLimit);

    if ((policy.requests === undefined) !== (policy.seconds === undefined)) {
      throw new Error(
        `REST ${this.router.namespace}.${this.operation} declares half a rate-limit window: ` +
          "requests and seconds travel together or not at all",
      );
    }

    return new RouteBuilder<Api, S>(this.router, this.method, this.path, this.operation, {
      ...this.state,
      rateLimit: policy,
    });
  }

  /**
   * How long this route's answer stands, and the tag a family drops its own
   * entries under. Only the validated bytes are stored, so a route that writes
   * its own answer, or declares none, cannot be cached.
   */
  withCache(policy: RestCachePolicy): RouteBuilder<Api, S> {
    assertSourceUnset("cache", this.state.cache);
    assertCachePolicy({ operation: this.operation, policy });

    return new RouteBuilder<Api, S>(this.router, this.method, this.path, this.operation, {
      ...this.state,
      cache: policy,
    });
  }

  /**
   * What the tenant behind the request must hold beside the permission. Asked
   * after access is decided, at the scope access resolved, so a caller who may
   * not do this at all is refused before the plan is ever looked up.
   */
  withEntitlement(entitlement: ApiEntitlement): RouteBuilder<Api, S> {
    assertSourceUnset("entitlement", this.state.entitlement);

    return new RouteBuilder<Api, S>(this.router, this.method, this.path, this.operation, {
      ...this.state,
      entitlement,
    });
  }

  /**
   * Makes this create safe to retry under a caller-chosen key. The tenancy the
   * key is unique within is the scope access resolved, never a callback, so a
   * route cannot key a create outside the door it answers behind.
   */
  withIdempotency(idempotency: RestIdempotency): RouteBuilder<Api, S> {
    assertSourceUnset("idempotency", this.state.idempotency);

    return new RouteBuilder<Api, S>(this.router, this.method, this.path, this.operation, {
      ...this.state,
      idempotency,
    });
  }

  withQuery<Schema extends z.ZodObject>(
    schema: Schema & DistinctSchema<Schema, S["params"]> & DistinctSchema<Schema, S["body"]>,
  ): RouteBuilder<Api, With<S, { query: Schema }>> {
    assertSourceUnset("query", this.state.query);
    assertDistinctSources(this.state.params, schema);
    assertDistinctSources(this.state.input, schema);

    return new RouteBuilder<Api, With<S, { query: Schema }>>(
      this.router,
      this.method,
      this.path,
      this.operation,
      {
        ...this.state,
        query: schema,
      },
    );
  }

  /**
   * The permission this route demands, and where it is asked. `{ at: "route",
   * param }` asks it at the scope the route's own path names, for a family
   * whose credential is one tier wider than the resource it addresses.
   */
  withPermission(
    permission: AuthzPermission,
    target?: RestPermissionTarget,
  ): RouteBuilder<Api, With<S, { permission: true }>> {
    return new RouteBuilder<Api, With<S, { permission: true }>>(
      this.router,
      this.method,
      this.path,
      this.operation,
      {
        ...this.state,
        permission,
        ...(target ? { permissionTarget: target } : {}),
      },
    );
  }

  /**
   * Declares how the route is reached instead of naming a permission:
   * `publicRoute` resolves no credential, so its handler gets a null actor/scope
   * and the document publishes no security requirement; `anyAuthenticated` still opens the door.
   */
  withAccess<Kind extends RouteAccess>(
    access: Kind,
  ): RouteBuilder<Api, With<S, { permission: true; access: Kind["kind"] }>> {
    return new RouteBuilder<Api, With<S, { permission: true; access: Kind["kind"] }>>(
      this.router,
      this.method,
      this.path,
      this.operation,
      {
        ...this.state,
        access,
      },
    );
  }

  withVersion(version: DateVersion): RouteBuilder<Api, S> {
    assertVersionLabel(version);

    return new RouteBuilder<Api, S>(this.router, this.method, this.path, this.operation, {
      ...this.state,
      version,
    });
  }

  withDocs(docs: RestTransportDocs): RouteBuilder<Api, S> {
    return new RouteBuilder<Api, S>(this.router, this.method, this.path, this.operation, {
      ...this.state,
      docs,
    });
  }

  /** Marks this one route superseded, whatever the family declared. */
  withDeprecated(deprecated: RestDeprecation): RouteBuilder<Api, S> {
    return new RouteBuilder<Api, S>(this.router, this.method, this.path, this.operation, {
      ...this.state,
      deprecated,
    });
  }

  withOutput<Schema extends OutputSchema>(
    schema: Schema,
  ): RouteBuilder<Api, With<S, { answer: Schema }>> {
    assertSourceUnset("output", this.state.output ?? this.state.answers);
    assertSchemaAnswerFree({ operation: this.operation, state: this.state });

    return new RouteBuilder<Api, With<S, { answer: Schema }>>(
      this.router,
      this.method,
      this.path,
      this.operation,
      {
        ...this.state,
        output: schema,
      },
    );
  }

  /**
   * The several answers this route may give, each with the body it carries:
   * `responds({ 200: report, 503: report })`. An unhealthy report is an answer,
   * not a failure — the handler returns `{ status, body }` typed by this declaration.
   */
  responds<const Answers extends RestRouteAnswers>(
    answers: Answers,
  ): RouteBuilder<Api, With<S, { answer: Answers }>> {
    assertSourceUnset("output", this.state.output ?? this.state.answers);
    assertSchemaAnswerFree({ operation: this.operation, state: this.state });
    assertDeclaredAnswers({ operation: this.operation, answers });

    return new RouteBuilder<Api, With<S, { answer: Answers }>>(
      this.router,
      this.method,
      this.path,
      this.operation,
      {
        ...this.state,
        answers,
      },
    );
  }

  /**
   * The route writes its own body, so no schema describes it: the handler
   * returns `{ status, headers, body }` or a whole `Response` it is
   * forwarding, and the document publishes the media types it names.
   */
  withRawResponse(
    options: Readonly<{ produces: string | readonly string[] }>,
  ): RouteBuilder<Api, With<S, { answer: RestRawAnswerDeclared }>> {
    assertSourceUnset("rawResponse", this.state.rawResponse);
    assertSchemaAnswerFree({ operation: this.operation, state: this.state });

    const produces = typeof options.produces === "string" ? [options.produces] : options.produces;

    assertProduces({ operation: this.operation, produces });

    return new RouteBuilder<Api, With<S, { answer: RestRawAnswerDeclared }>>(
      this.router,
      this.method,
      this.path,
      this.operation,
      {
        ...this.state,
        rawResponse: { produces: [...produces] },
      },
    );
  }

  /**
   * The kind of answer this route gives when it is not JSON. The handler is
   * handed the one producer that makes that kind, and can return nothing else:
   * there is no second way to write bytes, events, a redirect or a foreign wire.
   */
  withResponse<
    const Kind extends RestResponseKind,
    const Produces extends string | readonly string[] = string,
  >(
    kind: Kind,
    options: RestResponseOptions<Kind, Produces>,
  ): RouteBuilder<Api, With<S, { answer: RestResponseDeclared<Kind, Produces> }>> {
    assertSourceUnset("response", this.state.response);
    assertSchemaAnswerFree({ operation: this.operation, state: this.state });

    const declared = declaredProduces(options);
    const named = declared === undefined ? defaultProducesFor(kind) : declared;

    assertResponseKind({
      operation: this.operation,
      kind,
      produces: named,
      because: declaredReason(options),
    });

    return new RouteBuilder<Api, With<S, { answer: RestResponseDeclared<Kind, Produces> }>>(
      this.router,
      this.method,
      this.path,
      this.operation,
      {
        ...this.state,
        response: {
          kind,
          produces: [...named],
          ...(declaredReason(options) === undefined ? {} : { because: declaredReason(options) }),
        },
      },
    );
  }

  /**
   * Every method this one declaration answers. `["GET", "HEAD"]` is the twin a
   * reader publishes: Hono answers HEAD from the GET route, and the runtime
   * drops the body it would have written rather than leaving the stream open.
   */
  methods(names: readonly RestMethodName[]): RouteBuilder<Api, S> {
    const methods = names.map((name) => name.toLowerCase() as HttpMethod);

    assertSourceUnset("methods", this.state.methods);
    assertDeclaredMethods({ operation: this.operation, method: this.method, methods });

    return new RouteBuilder<Api, S>(this.router, this.method, this.path, this.operation, {
      ...this.state,
      methods,
    });
  }

  /**
   * One path, whatever method arrives: an alias that rewrites and forwards, a
   * handshake whose own library terminates the request. It publishes no
   * operation, because it has none to publish, and writes its own answer.
   */
  anyMethod(): RouteBuilder<Api, S> {
    return new RouteBuilder<Api, S>(this.router, this.method, this.path, this.operation, {
      ...this.state,
      anyMethod: true,
    });
  }

  handle<TResult extends RouteResult<S["answer"]>>(
    this: [
      RouteReady<S["path"], S["params"], S["permission"]>,
      JsonDeclarationsReady<S["strict"], S["body"], S["answer"], S["access"]>,
    ] extends [true, true]
      ? RouteBuilder<Api, S>
      : never,
    handler: (
      args: HandlerArgumentsFor<
        S["access"],
        RouteInput<S["params"], S["query"], S["body"]>,
        Api,
        S["door"]
      > &
        RawBodyArguments<S["body"]> &
        MultipartArguments<S["body"]> &
        RawResponseArguments<S["answer"]> &
        ResponseArguments<S["answer"]>,
      ...facts: MiddlewareFacts<S["middleware"]>
    ) => TResult & OutputResultCheck<S["answer"], TResult>,
  ): RestTransportRouter<Api, S["family"], S["strict"]> {
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

  withStatus(status: ContentfulStatusCode): RouteBuilder<Api, S> {
    if (!Number.isInteger(status) || status < 200 || status > 299) {
      throw new Error(
        "REST JSON success status must be 200–299 except 204; omit output for no content",
      );
    }

    return new RouteBuilder<Api, S>(this.router, this.method, this.path, this.operation, {
      ...this.state,
      status,
    });
  }

  withBodyLimit(limit: Readonly<{ maxBytes: number; onExceeded?(): Error }>): RouteBuilder<Api, S> {
    if (!Number.isSafeInteger(limit.maxBytes) || limit.maxBytes < 0)
      throw new Error("REST body limit must be a non-negative safe integer");

    return new RouteBuilder<Api, S>(this.router, this.method, this.path, this.operation, {
      ...this.state,
      bodyLimit: {
        maxBytes: limit.maxBytes,
        onExceeded: limit.onExceeded ?? (() => new PayloadTooLargeError()),
      },
    });
  }

  withHeaders<Schema extends z.ZodObject>(schema: Schema) {
    const headers: RestTransportMiddleware<Schema> = Object.freeze({
      name: `headers:${this.operation}`,
      schema,
      source: "headers",
    });

    return this.withMiddleware(headers);
  }

  withMiddleware<const Added extends readonly RestTransportMiddleware[]>(
    ...middleware: Added
  ): RouteBuilder<Api, With<S, { middleware: [...S["middleware"], ...Added] }>> {
    return new RouteBuilder<Api, With<S, { middleware: [...S["middleware"], ...Added] }>>(
      this.router,
      this.method,
      this.path,
      this.operation,
      {
        ...this.state,
        middleware: [...(this.state.middleware ?? []), ...middleware],
      },
    );
  }

  /**
   * The door THIS route answers behind, where it differs from the family's own:
   * retypes the handler's actor/scope through `DOOR_SCOPE_TIER`, so the route
   * reads the scope ITS door resolves, not the family's.
   */
  withCredential<NewDoor extends RestDoorCredential>(
    credential: NewDoor,
  ): RouteBuilder<Api, With<S, { door: NewDoor }>> {
    assertSourceUnset("credential", this.state.credential);

    return new RouteBuilder<Api, With<S, { door: NewDoor }>>(
      this.router,
      this.method,
      this.path,
      this.operation,
      {
        ...this.state,
        credential,
      },
    );
  }

  /**
   * The trail this route leaves. The runtime writes the row from the actor, the
   * route's own parameters and the answer's id, so the App carries none of it;
   * a declared action with no audit sink on the runtime is refused at mount.
   */
  withAudit(action: string): RouteBuilder<Api, S> {
    assertAuditAction(action);
    assertSourceUnset("audit", this.state.audit);

    return new RouteBuilder<Api, S>(this.router, this.method, this.path, this.operation, {
      ...this.state,
      audit: action,
    });
  }
}

/**
 * An audit action names what happened, as `<subject>.<verb>`: the trail is read
 * by subject, and a free-form sentence cannot be grouped.
 */
function assertAuditAction(action: string): void {
  if (!/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/.test(action)) {
    throw new Error(`REST audit action "${action}" must be dotted lower kebab case`);
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
    ...(state.response ? { response: state.response } : {}),
    ...(state.credential ? { credential: state.credential } : {}),
    ...(state.audit ? { audit: state.audit } : {}),
  };
}

/** A route just opened on a family's door: nothing declared but its address. */
type OpenRoute<
  Api,
  Method extends HttpMethod,
  Path extends string,
  Door extends RestDoorCredential,
  StrictJsonSchemas extends boolean,
> = RouteBuilder<
  Api,
  {
    method: Method;
    path: Path;
    params: Missing;
    body: Missing;
    query: Missing;
    answer: Missing;
    permission: false;
    middleware: [];
    access: "scoped";
    family: Door;
    door: Door;
    strict: StrictJsonSchemas;
  }
>;

class RestTransportRouter<
  Api,
  Door extends RestDoorCredential = "project",
  StrictJsonSchemas extends boolean = false,
> {
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
  ): RestTransportRouter<Api, NewDoor, StrictJsonSchemas> {
    if (this.routes.length > 0) {
      throw new Error(`REST "${this.namespace}" must declare its credential before its routes`);
    }

    const router = new RestTransportRouter<Api, NewDoor, StrictJsonSchemas>(
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
  ): RestTransportRouter<Api, Door, StrictJsonSchemas> {
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
  withDeprecated(deprecated: RestDeprecation): RestTransportRouter<Api, Door, StrictJsonSchemas> {
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

  get<Path extends string>(
    path: Path,
    operation: string,
  ): OpenRoute<Api, "get", Path, Door, StrictJsonSchemas> {
    assertSupportedPath({
      path,
      addressing: this.addressing,
      root: this.root,
      namespace: this.namespace,
    });

    return new RouteBuilder(this, "get", path, operation);
  }

  patch<Path extends string>(
    path: Path,
    operation: string,
  ): OpenRoute<Api, "patch", Path, Door, StrictJsonSchemas> {
    assertSupportedPath({
      path,
      addressing: this.addressing,
      root: this.root,
      namespace: this.namespace,
    });

    return new RouteBuilder(this, "patch", path, operation);
  }

  post<Path extends string>(
    path: Path,
    operation: string,
  ): OpenRoute<Api, "post", Path, Door, StrictJsonSchemas> {
    assertSupportedPath({
      path,
      addressing: this.addressing,
      root: this.root,
      namespace: this.namespace,
    });

    return new RouteBuilder(this, "post", path, operation);
  }

  put<Path extends string>(
    path: Path,
    operation: string,
  ): OpenRoute<Api, "put", Path, Door, StrictJsonSchemas> {
    assertSupportedPath({
      path,
      addressing: this.addressing,
      root: this.root,
      namespace: this.namespace,
    });

    return new RouteBuilder(this, "put", path, operation);
  }

  delete<Path extends string>(
    path: Path,
    operation: string,
  ): OpenRoute<Api, "delete", Path, Door, StrictJsonSchemas> {
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
 * method, path, sources, permission, answer and documentation - because REST
 * shares no declaration with a browser client the way tRPC does.
 */
export function defineRestRouter<Api, StrictJsonSchemas extends boolean = false>(
  api: FeatureApiWitness<Api>,
) {
  return {
    /** The family's own path segment: the routes answer under `/api/<namespace>`. */
    withNamespace(namespace: string) {
      assertNamespace(namespace);

      return {
        withVersion(version: DateVersion): RestTransportRouter<Api, "project", StrictJsonSchemas> {
          assertVersionLabel(version);

          return new RestTransportRouter<Api, "project", StrictJsonSchemas>(
            api,
            namespace,
            version,
            "project",
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
  // and here it would hang the route off the root of the process - which is
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

function assertPublicRouteConstraints({
  operation,
  state,
}: {
  operation: string;
  state: RouteState;
}): void {
  if (state.access?.kind !== "public") return;

  assertNoScopeInput({ operation, state });

  // Both ask a question about a tenant, and a public route resolves none.
  if (state.entitlement) {
    throw new Error(
      `REST ${operation} answers without a credential, so there is no tenant to ask whether it ` +
        `holds "${state.entitlement}"`,
    );
  }

  if (state.idempotency) {
    throw new Error(
      `REST ${operation} answers without a credential, so there is no tenancy a caller's ` +
        "idempotency key is unique within",
    );
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

  assertPublicRouteConstraints({ operation, state });

  if (state.answers && state.status !== void 0) {
    throw new Error(`REST ${operation} declares responds(), so its status is the answer's own`);
  }

  if (state.permissionTarget) assertPermissionTarget({ operation, state });

  assertAnyMethodAnswer({ operation, state });

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

/**
 * A route that answers every method answers each of them differently, so no one
 * schema describes it: it forwards whatever it was handed.
 */
function assertAnyMethodAnswer({
  operation,
  state,
}: {
  operation: string;
  state: RouteState;
}): void {
  const forwards = state.rawResponse !== undefined || state.response?.kind === "forwarded";

  if (!state.anyMethod || forwards) return;

  throw new Error(
    `REST ${operation} answers every method, and no one schema describes what each of them ` +
      'answers with; it must declare withResponse("forwarded")',
  );
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

  if (!schema && !state.rawResponse && !state.response) return;

  throw new Error(`REST ${operation} declares its answer twice; a route answers one way`);
}

/**
 * What a declared kind must say for itself: the media types a published kind
 * names, and the reason a wire we do not own is written here at all.
 */
function assertResponseKind({
  operation,
  kind,
  produces,
  because,
}: {
  operation: string;
  kind: RestResponseKind;
  produces: readonly string[];
  because: string | undefined;
}): void {
  if (produces.some((mediaType) => mediaType.trim() === "")) {
    throw new Error(`REST ${operation} publishes a blank media type for its ${kind} answer`);
  }

  if (kind === "bytes" && produces.length === 0) {
    throw new Error(`REST ${operation} answers with bytes and names no media type it produces`);
  }

  if (kindNeedsReason(kind) && (because ?? "").trim() === "") {
    throw new Error(
      `REST ${operation} writes a ${kind} answer, which is a wire this framework does not own, ` +
        "and says no reason why",
    );
  }
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
  stream: "application/octet-stream",
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
    middleware?: readonly RestTransportMiddleware[];
  }>;
}): void {
  const target = state.permissionTarget!;
  const param = target.param;

  if (target.at === "header") {
    const declared = state.middleware?.some(
      (fact) =>
        fact.source === "headers" &&
        fact.schema instanceof z.ZodObject &&
        sourceKeys(fact.schema).includes(target.header),
    );

    if (!declared)
      throw new Error(
        `REST ${operation} checks header "${target.header}" without declaring it withHeaders()`,
      );

    return;
  }

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
 * The several answers a route declared: at least one, and one success - or the
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

  if (
    successes.length === 2 &&
    !successes.includes(204) &&
    answers[successes[0]!] !== answers[successes[1]!]
  ) {
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
