/**
 * The one execution path a mounted REST route runs - parse, authenticate,
 * decide, handle, check the answer, respond - and the mount that puts a
 * family's declaration behind it: the ports a process fills, the addresses each
 * route answers at, and the version guards that stand in front of them.
 */
import { actorSchema, type Actor } from "@langwatch/actor";
import type {
  AuthzDeclaredScopeId,
  AuthzPermission,
  PermissionDecision,
} from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger, validationMeta } from "@langwatch/observability";
import type { Context, ErrorHandler, Hono as HonoApp, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { mergePath } from "hono/utils/url";
import { uniqueSymbol, validator as openApiValidator } from "hono-openapi";
import type { z } from "zod";

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
  decideEntitlement,
  routeScopeOf,
  type AccessDenial,
  type Authorize,
  type Credential,
  type Entitlements,
} from "../access/access.ts";
import { RateLimitedError } from "../errors.ts";
import type { RateLimiter, ResponseCache } from "../ports.ts";
import {
  addressesOf,
  basePathOf,
  canonicalV1Path,
  isDateVersion,
  middlewareScopesOf,
  undescribedStack,
  type HttpMethod,
  type VersionStatus,
} from "./addressing.ts";
import type { RestResolvedInternalCredential } from "./credential.ts";
import {
  DOOR_SCOPE_TIER,
  permissionOf,
  type RestDeprecation,
  type RestDoorCredential,
  type RestRouteAnswers,
  type RestTransportDeclaration,
  type RestTransportRoute,
  type StoredHandlerArguments,
} from "./declaration.ts";
import {
  idempotentJson,
  IDEMPOTENCY_KEY_HEADER,
  readIdempotencyKey,
  type IdempotentRunner,
} from "./idempotency.ts";
import { deprecatedAlias, deprecationNotice, documentRoute } from "./openapi.ts";
import {
  bodyLimit,
  cachedRestAnswer,
  loggerMiddleware,
  multipartMiddleware,
  requestValidationErrorFrom,
  restCacheKey,
  restRateLimitKey,
  storeRestAnswer,
  tracerMiddleware,
  type RestRawAnswer,
  type RestRawBody,
  type RestTransportMiddlewareBinding,
} from "./request.ts";
import { DECLARED_ANSWER, ENDPOINT_ROUTE, isDeclined, REQUEST_FAMILY } from "./response.ts";
import { registerRoutePolicy } from "./security.ts";

const outputLogger = createLogger("langwatch:api:output-validation");

// ─────────────────────────────────────────────────────────────────────────────
// The one REST execution path: parse, authenticate, decide, handle, check the
// answer, respond. The request is parsed BEFORE the credential is resolved, so
// a malformed body is refused without ever touching the caller's key.
//
// A route answers at three addresses - its dated namespace, `latest`, and the
// family's bare path - plus the `/api/v1` twin of each, and any real date the
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

/**
 * What one door does: authenticate a caller behind a credential kind, identify
 * one with nothing asked of it, and answer a permission at a scope a route's
 * own path named.
 */
export type RestIdentity = Readonly<{
  authenticate(input: {
    request: Request;
    permission: AuthzPermission;
  }): Promise<RestCaller> | RestCaller;
  /**
   * The door, opened with no permission asked of it. Only a declaration
   * carrying an `anyAuthenticated` route needs it, and a mount that supplies
   * none is refused by name.
   */
  identify?(input: { request: Request }): Promise<RestCaller> | RestCaller;
  /**
   * The same door, opened for a caller who may have presented nothing: it
   * answers `null` for a request carrying no credential at all, and refuses
   * one carrying a credential it will not accept.
   */
  identifyOptional?(input: { request: Request }): Promise<RestCaller | null> | RestCaller | null;
  /**
   * Whether the caller holds `permission` at the scope a route's own path
   * named. Only a declaration carrying such a route needs it, and a mount that
   * supplies none is refused by name.
   */
  authorize?(input: {
    caller: RestCaller;
    permission: AuthzPermission;
    target: AuthzDeclaredScopeId;
  }): Promise<PermissionDecision> | PermissionDecision;
}>;

/**
 * What one finished route leaves on the trail. The runtime writes it; a route
 * that declared an action and reaches a runtime with no sink is refused at
 * mount, so a declared trail is never silently lost.
 */
export type RestAuditSink = Readonly<{
  record(row: RestAuditRow): Promise<void> | void;
}>;

/** One audit row: who, what, where, on which resource, and how it ended. */
export type RestAuditRow = Readonly<{
  actorId: string | null;
  action: string;
  scope: AuthzDeclaredScopeId | null;
  params: Readonly<Record<string, unknown>>;
  resultId: string | null;
  /** The handled error's own code, on a refusal; absent on an answer. */
  errorCode?: string;
}>;

/** Everything the process supplies for the path to run. */
export type RestRuntimePorts = Readonly<{
  /** The family's own door: the one every route falls back to. */
  identity: RestIdentity;
  /**
   * One door per credential kind a ROUTE may raise for itself. A route naming a
   * kind this table does not open is refused at mount, by kind.
   */
  doors?: Partial<Readonly<Record<RestDoorCredential, RestIdentity>>>;
  /** Where every route that declared an action leaves its row. */
  audit?: RestAuditSink;
  /** Only a family whose routes carry a check of their own supplies these. */
  authorization?: Readonly<{ forRequest(request: Request): Authorize }>;
  /** The counter behind every route that declared how often one caller may ask. */
  rateLimiter?: RateLimiter;
  /** The store behind every route that declared how long its answer stands. */
  cache?: ResponseCache;
  denials?: AccessDenial;
  /** What the process reads a tenant's entitlements from, for a route that asks. */
  entitlements?: Entitlements;
  /** The receipt ledger behind every create declared replayable. */
  idempotency?: IdempotentRunner;
  /** Where the first call of each deprecated route is recorded. */
  deprecationLog?: RestDeprecationLog;
}>;

/**
 * Told once per process the first time a deprecated route is called, so an
 * operator learns a superseded endpoint is still in use without a line per
 * request. Defaults to doing nothing.
 */
export type RestDeprecationLog = Readonly<{
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
   * a scope for - `public` - and naming a door credential that disagrees with
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

/**
 * The credential kind ONE route answers behind: the door it raised for itself,
 * or the one the mount named for the whole family.
 */
function routeCredential(route: RestTransportRoute<unknown>, family: Credential): Credential {
  return route.credential ?? family;
}

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
              route.access?.kind === "public" ? "none" : CREDENTIAL_CLASS[routeCredential(route, credential)],
            credential:
              route.access?.kind === "public" ? "public" : routeCredential(route, credential),
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

    if (route.credential && route.credential !== declaration.credential && !ports.doors?.[route.credential]) {
      throw new Error(
        `REST ${address} answers behind the "${route.credential}" door, and this runtime opens ` +
          "no door of that kind",
      );
    }

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

  if (route.entitlement && !ports.entitlements) {
    throw new Error(
      `REST ${address} asks whether its tenant holds "${route.entitlement}", and this runtime ` +
        "supplied no entitlements port to ask",
    );
  }

  if (route.idempotency && !ports.idempotency) {
    throw new Error(
      `REST ${address} declares itself replayable under a caller's key, and this runtime ` +
        "supplied no idempotency port to keep its receipts",
    );
  }

  if (route.audit && !ports.audit) {
    throw new Error(
      `REST ${address} declares the audit action "${route.audit}", and this runtime supplied ` +
        "no audit sink to write its row to",
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
  // browser session publishes none either - no API client can present a
  // cookie, so an advertised operation would be one nothing can call.
  const publishable = route.anyMethod !== true && declaration.credential !== "browser";
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
      credential: route.credential ?? declaration.credential,
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
 * answer carries - set in a `finally` so a refusal carries them too.
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
    const door = doorOf({ credential, ports });
    const caller = await callerOf({ route, door, request: context.req.raw });

    // An optional door the caller presented nothing at: the handler is told
    // there is no one behind the request rather than handed a guess.
    if (!caller) {
      const anonymous = await route.handler(
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

    const target = await checkRouteScope({ route, caller, door, ports, input });
    const capabilities = { route, ports, context, family, version, caller, input } as const;

    // The scope access resolved: the one a route's own path named when it named
    // one, and the door's own otherwise. Both the plan question and the
    // idempotency tenancy are asked about exactly this scope.
    const resolved = target ?? decision.scope;

    await checkEntitlement({ route, ports, scope: resolved, family });

    await countCall(capabilities);

    // After the door, never before it: a caller who may not read this cannot
    // be handed the bytes an entitled one left behind.
    const stored = await storedAnswer(capabilities);

    if (stored) return stored;

    const actor = doorActorOf({ credential, actor: decision.actor });
    const run = async (): Promise<Response | undefined> => {
      const result = await auditing({
        route,
        ports,
        actor,
        scope: resolved,
        context,
        run: async () =>
          route.handler(
            handlerArguments({
              context,
              route,
              options,
              input,
              actor,
              scope: handlerScopeOf({ route, credential, caller }),
              target,
            }),
            ...(await resolveFacts({ route, facts, context })),
          ),
      });

      caller.markUsed?.();

      return answerWith({ context, next, route, result });
    };

    const answer = route.idempotency
      ? await replayable({ route, ports, context, input, scope: resolved, family, run })
      : await run();

    return keepAnswer({ ...capabilities, answer });
  };
}

/**
 * The trail a route declared. The row is written from the actor the door
 * resolved, the parameters the path named and the id the answer carries; a
 * refusal writes the same row with the handled error's own code, so the trail
 * records what was attempted as well as what succeeded.
 *
 * A route with no declared action runs untouched, and the ONE place that
 * decides whether a row is written is this function.
 */
async function auditing<TResult>({
  route,
  ports,
  actor,
  scope,
  context,
  run,
}: {
  route: RestTransportRoute<unknown>;
  ports: RestRuntimePorts;
  actor: Actor | null;
  scope: AuthzDeclaredScopeId | null;
  context: Context;
  run: () => Promise<TResult>;
}): Promise<TResult> {
  const action = route.audit;

  if (!action) return run();

  const sink = requireAudit(ports);
  const params = auditParams({ route, context });

  try {
    const result = await run();

    await sink.record({
      actorId: normalizedActor(actor)?.id ?? null,
      action,
      scope,
      params,
      resultId: resultIdOf(result),
    });

    return result;
  } catch (error) {
    if (error instanceof HandledError) {
      await sink.record({
        actorId: normalizedActor(actor)?.id ?? null,
        action,
        scope,
        params,
        resultId: null,
        errorCode: error.code,
      });
    }

    throw error;
  }
}

/**
 * The parameters the route's own path named, as the row records them: the
 * declared parameters and nothing else, so the version segment a dated address
 * carries never reaches the trail.
 */
function auditParams({
  route,
  context,
}: {
  route: RestTransportRoute<unknown>;
  context: Context;
}): Readonly<Record<string, unknown>> {
  const declared = route.params;

  if (!declared) return {};

  const dispatched = context.get(ROUTE_PARAMS) as Record<string, string> | undefined;
  const named = dispatched ?? context.req.param();
  const params: Record<string, unknown> = {};

  for (const key of Object.keys(declared.shape)) {
    if (key in named) params[key] = named[key];
  }

  return params;
}

/** The id the answer carries, when it carries one: what the action acted on. */
function resultIdOf(result: unknown): string | null {
  if (typeof result !== "object" || result === null) return null;

  const id: unknown = (result as Record<string, unknown>).id;

  return typeof id === "string" ? id : null;
}

/** @see assertCapabilityPorts, which refuses this before a request arrives. */
function requireAudit(ports: RestRuntimePorts): RestAuditSink {
  const audit = ports.audit;

  if (!audit) throw new Error("REST runtime supplied no audit sink");

  return audit;
}

/**
 * The plan question, asked after access is decided and before anything the
 * handler would have done - including the rate-limit count, which an unentitled
 * caller never spends.
 */
async function checkEntitlement({
  route,
  ports,
  scope,
  family,
}: {
  route: RestTransportRoute<unknown>;
  ports: RestRuntimePorts;
  scope: AuthzDeclaredScopeId | null;
  family: string;
}): Promise<void> {
  if (!route.entitlement || !ports.entitlements) return;

  await decideEntitlement({
    entitlement: route.entitlement,
    scope,
    entitlements: ports.entitlements,
    address: `REST ${family}.${route.operation}`,
  });
}

/**
 * The create, dispatched through the process's receipt ledger under the key the
 * caller chose. The tenancy is the scope access resolved, and the answer is the
 * bytes the ledger stored, marked as a replay.
 */
async function replayable({
  route,
  ports,
  context,
  input,
  scope,
  family,
  run,
}: {
  route: RestTransportRoute<unknown>;
  ports: RestRuntimePorts;
  context: Context;
  input: unknown;
  scope: AuthzDeclaredScopeId | null;
  family: string;
  run: () => Promise<Response | undefined>;
}): Promise<Response | undefined> {
  const idempotency = route.idempotency;

  if (!idempotency || !ports.idempotency) return run();

  if (!scope) {
    throw new Error(
      `REST ${family}.${route.operation} is replayable under a caller's key, and access resolved ` +
        "no tenancy that key would be unique within",
    );
  }

  const outcome = await ports.idempotency({
    operation: idempotency.operation,
    scopeId: scope.id,
    key: readIdempotencyKey(context.req.header(IDEMPOTENCY_KEY_HEADER)),
    validatedBody: input,
    handler: async () => {
      const answer = await run();

      if (!answer) {
        throw new Error(
          `REST ${family}.${route.operation} is replayable and wrote no response for its ` +
            "receipt to stand in for",
        );
      }

      return answer;
    },
  });

  return idempotentJson({ c: context, outcome });
}

/** The logger both capabilities report a store's own failure through. */
const capabilityLogger = createLogger("langwatch:api:endpoint-capabilities");

/**
 * The call, counted. The key is the framework's - this family, this operation,
 * this version, this principal - and a caller past the limit is refused with
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
 * The answer: the declared schema's, the route's own bytes, or - from an
 * any-method route that recognised nothing of its own - none at all, so
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
  door,
  ports,
  input,
}: {
  route: RestTransportRoute<unknown>;
  caller: RestCaller;
  door: RestIdentity;
  ports: RestRuntimePorts;
  input: unknown;
}): Promise<AuthzDeclaredScopeId | null> {
  if (!route.permissionTarget) return null;

  const permission = permissionOf(route.permission);
  const target = routeScopeOf({ param: route.permissionTarget.param, input });

  const decision = await requireAuthorize(door)({ caller, permission, target });

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
 * have presented nothing - the one question that can answer with nobody.
 */
async function callerOf({
  route,
  door,
  request,
}: {
  route: RestTransportRoute<unknown>;
  door: RestIdentity;
  request: Request;
}): Promise<RestCaller | null> {
  const kind = route.access?.kind;

  if (kind === "optional") return requireIdentifyOptional(door)({ request });

  if (kind === "authenticated" || kind === "deferred") return requireIdentify(door)({ request });

  return door.authenticate({ request, permission: permissionOf(route.permission) });
}

/**
 * The door this ONE route answers behind: the kind it declared for itself, or
 * the family's own. A kind the runtime opens no door for is refused at mount.
 */
function doorOf({
  credential,
  ports,
}: {
  credential: RestDoorCredential;
  ports: RestRuntimePorts;
}): RestIdentity {
  return ports.doors?.[credential] ?? ports.identity;
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
  door: RestIdentity,
): NonNullable<RestIdentity["identifyOptional"]> {
  const identifyOptional = door.identifyOptional;

  if (!identifyOptional) throw new Error("REST runtime supplied no identity.identifyOptional");

  return identifyOptional.bind(door);
}

/** @see assertPortsBound, which refuses these before a request arrives. */
function requireIdentify(door: RestIdentity): NonNullable<RestIdentity["identify"]> {
  const identify = door.identify;

  if (!identify) throw new Error("REST runtime supplied no identity.identify");

  return identify.bind(door);
}

/** @see assertPortsBound, which refuses these before a request arrives. */
function requireAuthorize(door: RestIdentity): NonNullable<RestIdentity["authorize"]> {
  const authorize = door.authorize;

  if (!authorize) throw new Error("REST runtime supplied no identity.authorize");

  return authorize.bind(door);
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
 * caller can act on it. The credential-class refusal a CALLER earns - a
 * project key at an organization family - is the door's own, thrown before
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
  // resolved none - and, for the shared secret, to name which one let the
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
 * handler, but only the declared ones are servable - an undeclared status is a
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
      credential: "public",
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
  credential,
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
  credential: Credential;
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
      credential,
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
  project: "apiKey",
  organization: "apiKey",
  scimToken: "apiKey",
  "instance-admin": "apiKey",
  browser: "session",
  internalSecret: "internal",
} as const satisfies Record<Exclude<Credential, "public">, HandlerCredential>;

/** Which security scheme a consumer of each credential presents. */
const CREDENTIAL_CLASS = {
  project: "project_api_key",
  organization: "organization_api_key",
  scimToken: "scim_token",
  "instance-admin": "instance_admin_api_key",
  browser: "session",
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
