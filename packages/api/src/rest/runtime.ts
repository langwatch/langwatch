import {
  actorSchema,
  type Actor,
  type Authorization,
  type AuthzDeclaredScopeId,
  type AuthzPermission,
  internalActor,
} from "@langwatch/authorization";
import { HandledError } from "@langwatch/handled-error";
import { createLogger, validationMeta } from "@langwatch/observability";
import type { Context, ErrorHandler, Hono as HonoApp, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { uniqueSymbol, validator as openApiValidator } from "hono-openapi";
import { matchedRoutes } from "hono/route";
import type { RouterRoute } from "hono/types";
import { COMPOSED_HANDLER } from "hono/utils/constants";
import type { ContentfulStatusCode, StatusCode } from "hono/utils/http-status";
import { mergePath } from "hono/utils/url";
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
  assertSecondFactor,
  chosenPermission,
  decide,
  decideEntitlement,
  decidePlatform,
  gatedDecision,
  mintAuthorization,
  platformRefusal,
  refuseImpersonatedMint,
  asksAggregateWrite,
  refuseWriteUnderAggregate,
  routeScopeOf,
  scopeWithOrganization,
  type AccessActor,
  type AccessDenial,
  type Authorize,
  type Credential,
  type Entitlements,
  type PlatformPermissionDeclaration,
} from "../access/access.ts";
import {
  MediaTypeMalformedRequestError,
  RateLimitedError,
  SurfaceUnverifiedError,
  UnsupportedMediaTypeError,
} from "../errors.ts";
import type { RestAuditSink, RestCaller, RestIdentity } from "../hosting/api-door.ts";
import { ClientAddress } from "../policy/client-address.ts";
import type { RateLimiter, ResponseCache } from "../ports.ts";
import { type RegisteredSharedPath, registerRoutePolicy } from "../route-registry.ts";
import {
  addressesOf,
  basePathOf,
  canonicalV1Path,
  claimsNoPrefix,
  isDateVersion,
  middlewareScopesOf,
  undescribedStack,
  VERSION_NAMESPACE,
  type HttpMethod,
  type VersionStatus,
} from "./addressing.ts";
import {
  admittedOwnerlessProjectKeyFor,
  OWNERLESS_PROJECT_KEY_PROOF_CODE_PATH,
} from "./credential.ts";
import {
  DOOR_SCOPE_TIER,
  permissionOf,
  routePermissions,
  type RestDeprecation,
  type RestDoorCredential,
  type RestPermissionTarget,
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
import {
  assertKeyKind,
  isKeyDoor,
  keyCredentialOfDoor,
  recordedKeyOfDoor,
  type RestKeyCredential,
} from "./key-credential.ts";
import { legacyErrorScopes, withLegacyError } from "./legacy-error.ts";
import {
  CREDENTIAL_CLASS_BY_DOOR as CREDENTIAL_CLASS,
  deprecatedAlias,
  deprecationNotice,
  documentRoute,
  requiresBody,
} from "./openapi.ts";
import {
  bodyLimit,
  cachedRestAnswer,
  isBodyAbsent,
  MalformedRequestError,
  loggerMiddleware,
  multipartMiddleware,
  refusingMalformedBody,
  requestValidationErrorFrom,
  restCacheKey,
  restRateLimitKey,
  storeRestAnswer,
  tracerMiddleware,
  type RestDoor,
  type RestRawAnswer,
  type RestInputMediaType,
  type RestRawBody,
  type MiddlewareContextBinding,
  type MiddlewareContext,
} from "./request.ts";
import {
  isProducedAnswer,
  producedKind,
  producerFor,
  refusalProducer,
  type RestEvent,
  type RestProtocolRefusal,
  type RestResponseKind,
} from "./response-kind.ts";
import {
  DECLARED_ANSWER,
  ENDPOINT_ROUTE,
  isDeclined,
  REQUEST_FAMILY,
  withRetryAfter,
} from "./response.ts";

const outputLogger = createLogger("langwatch:api:output-validation");

// The one REST execution path: authenticate, parse, decide, handle, check answer, respond.
// The caller is authenticated BEFORE the body is parsed, so a refused credential never learns
// the body failed its schema (ARCHITECTURE.md §8). Routes answer at three addresses (dated
// namespace, `latest`, bare path) plus v1 twins.

const ROUTE_PARAMS = "routeParams" as const;
const VERSION_REQUEST = "apiVersionRequest" as const;
const ROUTE_INPUT = "endpointInput" as const;
const ROUTE_HEADER_CONTEXT = "endpointHeaderContext" as const;
const ROUTE_RAW_BODY = "endpointRawBody" as const;
const ROUTE_BODY_SCOPE = "endpointBodyScope" as const;
const ROUTE_FORM_FIELDS = "endpointFormFields" as const;
const ROUTE_FILES = "endpointFiles" as const;

/** Everything the process supplies for the path to run. */
export type RestRuntimeMembers = Readonly<{
  /** The family's own door: the one every route falls back to. */
  identity: RestDoor;
  /**
   * One door per credential kind a ROUTE may raise for itself. A route naming a
   * kind this table does not open is refused at mount, by kind.
   */
  doors?: Partial<Readonly<Record<RestDoorCredential, RestDoor>>>;
  /** Where every route that declared an action leaves its row. */
  audit?: RestAuditSink;
  /** The decisions every route is authorized through; required, so no check is skipped. */
  authorization: Readonly<{ forRequest(request: Request): Authorize }>;
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
  /** The credential class exposed by this mount; `public` resolves no scope. */
  credential?: Credential;
  /** The family's own error boundary: it renders every refusal these routes raise. */
  onError: ErrorHandler;
  /** Applied under the family's paths before any route: the app container. */
  middleware?: readonly MiddlewareHandler[];
  /**
   * One binding per middleware context the declaration's routes name. A declared
   * context with no binding here is refused at mount rather than reaching a handler unset.
   */
  middlewareContext?: readonly MiddlewareContextBinding[];
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
function mountFamilyRoutes<Api>({
  app,
  basePath,
  declaration,
  ports,
  options,
  contexts,
  credential,
}: {
  app: HonoApp;
  basePath: string;
  declaration: RestTransportDeclaration<Api>;
  ports: RestRuntimeMembers;
  options: RestMountOptions<Api>;
  contexts: ReadonlyMap<string, MiddlewareContextBinding>;
  credential: Credential;
}): Map<string, Set<HttpMethod>> {
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
          contexts,
          ...mount.context,
        }),
        policy: registryPolicy({ route, options, credential }),
        credentialClass:
          route.access?.kind === "public"
            ? "none"
            : CREDENTIAL_CLASS[routeCredential(route, credential)],
        credential: route.access?.kind === "public" ? "public" : routeCredential(route, credential),
        family: declaration.namespace,
        ...(route.sharedPath
          ? { sharedPath: { ...route.sharedPath, servedBy: declaration.api.name } }
          : {}),
        served,
      });
    }
  }

  return served;
}

/**
 * A shared path names an owner other than its server, in a family claiming no prefix: a literal
 * one, or a dated one whose every route shares one owner's namespace (§8, R10).
 */
function assertSharedPaths<Api>(declaration: RestTransportDeclaration<Api>): void {
  const owners = new Set<string>();

  for (const route of declaration.routes) {
    if (!route.sharedPath) continue;

    const where = `REST ${route.method.toUpperCase()} ${route.path} of ${declaration.api.name}`;

    if (route.sharedPath.owner === declaration.api.name) {
      throw new Error(`${where} declares a shared path with its own module; drop withSharedPath`);
    }

    if (declaration.addressing !== "literal" && declaration.addressing !== "dated") {
      throw new Error(
        `${where} declares a shared path in the "${declaration.addressing}" family ` +
          `"${declaration.namespace}"; serve it from a literal or a dated family`,
      );
    }

    owners.add(route.sharedPath.owner);
  }

  if (declaration.addressing !== "dated" || owners.size === 0) return;

  if (owners.size > 1 || !claimsNoPrefix(declaration)) {
    throw new Error(
      `REST dated family "${declaration.namespace}" of ${declaration.api.name} both owns and ` +
        `shares a namespace (${[...owners].join(", ")}); serve the shared routes, all naming ` +
        "one owner, from a dated family of their own",
    );
  }
}

export function createRestRuntime(ports: RestRuntimeMembers): RestRuntime {
  return {
    mount: (declaration, options) => {
      const dated = declaration.addressing === "dated";
      const basePath = basePathOf(declaration);
      const app = new Hono();
      const scopes = middlewareScopesOf(declaration);
      const contexts = contextBindings({ declaration, options });
      const credential = mountCredential({ declaration, options });

      assertSharedPaths(declaration);
      assertPortsBound({ declaration, ports });

      for (const middleware of [
        tracerMiddleware({ name: declaration.namespace }),
        loggerMiddleware({ name: declaration.namespace }),
        ...(options.middleware ?? []),
      ]) {
        for (const scope of scopes) app.use(scope, middleware);
      }

      const served = mountFamilyRoutes({
        app,
        basePath,
        declaration,
        ports,
        options,
        contexts,
        credential,
      });

      mountMethodGuards({ app, served });

      if (dated) mountVersionGuards({ app, basePath, declaration, ports, options, contexts });

      app.onError(withRetryAfter(protocolRefusals(withLegacyError(options.onError))));

      return app;
    },
  };
}

/** The route a request reached and the refusal it answers in, when it renders its own. */
type RouteRefusalScope = Readonly<{
  route: RestTransportRoute<unknown>;
  refusal: RestProtocolRefusal;
}>;

const refusingRoutes = new WeakMap<Context, RouteRefusalScope>();

/** Marks the request as one whose every refusal the route's protocol renders. */
function protocolRefusalScope(refusing: RouteRefusalScope): MiddlewareHandler {
  return async (context, next) => {
    refusingRoutes.set(context, refusing);
    await next();
  };
}

/**
 * The family's error boundary, except on a route whose protocol declared its own
 * refusal: there the door's, the parser's and the handler's refusals all answer in
 * that protocol's document (ARCHITECTURE.md §8), save one the refusal declines.
 */
function protocolRefusals(onError: ErrorHandler): ErrorHandler {
  return (error, context) => {
    const refusing = refusingRoutes.get(context);

    if (!refusing) return onError(error, context);

    const { route, refusal } = refusing;
    const result = refusal({ failure: error, response: refusalProducer() });
    if (isDeclined(result)) return onError(error, context);

    return respondProduced({ context, route, result, kind: "protocol" });
  };
}

/**
 * The refusal a protocol route declared, the one a `responds()` route keeps its wire with,
 * or else its door's: the owner's wire for every route behind that door (Q31).
 */
function routeRefusal({
  route,
  door,
}: {
  route: RestTransportRoute<unknown>;
  door: RestDoor;
}): RestProtocolRefusal | undefined {
  return route.response?.refusal ?? route.refusal ?? door.refusal;
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
  ports: RestRuntimeMembers;
}): void {
  // Required by the type; refused here too, for a caller that reached the mount untyped.
  if (!ports.authorization) {
    throw new Error(
      `REST ${declaration.namespace} is mounted with no authorization port, and every route is ` +
        "authorized through one",
    );
  }

  const base = basePathOf(declaration);

  for (const route of declaration.routes) {
    const address = `${route.method.toUpperCase()} ${base}${route.path}`;

    if (
      route.credential &&
      route.credential !== declaration.credential &&
      !ports.doors?.[route.credential]
    ) {
      throw new Error(
        `REST ${address} answers behind the "${route.credential}" door, and this runtime opens ` +
          "no door of that kind",
      );
    }

    const door = doorOf({ credential: route.credential ?? declaration.credential, ports });

    assertReachDoor({ address, route, credential: route.credential ?? declaration.credential });

    assertAfterBodyPorts({
      address,
      route,
      door,
      credential: route.credential ?? declaration.credential,
    });

    const credential = route.credential ?? declaration.credential;

    if (identifiedFirst({ route, credential }) && !door.identify) {
      throw new Error(
        `REST ${address} answers behind the family's door with no permission, and this runtime ` +
          "supplied no identity.identify",
      );
    }

    assertCapabilityPorts({ address, route, ports });

    assertDoorQuestions({ address, route, door, credential });

    if (anonymousOnRefusal(route) && !door.identify) {
      throw new Error(
        `REST ${address} answers a refused credential as none, and this runtime ` +
          "supplied no identity.identify",
      );
    }

    if (route.access?.kind === "optional" && !anonymousOnRefusal(route) && !door.identifyOptional) {
      throw new Error(
        `REST ${address} answers with or without the family's credential, and this runtime ` +
          "supplied no identity.identifyOptional",
      );
    }
  }
}

/**
 * A platform route needs the door's platform question (E4), and a permission behind the CLI
 * token door needs the question it asks at the token's organization (E8).
 */
function assertDoorQuestions({
  address,
  route,
  door,
  credential,
}: {
  address: string;
  route: RestTransportRoute<unknown>;
  door: RestIdentity;
  credential: RestDoorCredential;
}): void {
  if (route.permissionPlatform && !door.authorizePlatform) {
    throw new Error(
      `REST ${address} asks "${route.permission}" at the platform, and this runtime supplied no ` +
        "identity.authorizePlatform",
    );
  }

  if (credential === "cli_token" && !route.access && !door.authorize) {
    throw new Error(
      `REST ${address} asks "${routePermissions(route).join(", ")}" behind the CLI token door, ` +
        "and that door was built with no way to ask it at the token's organization",
    );
  }

  if (route.key && !isKeyDoor(credential)) {
    throw new Error(
      `REST ${address} reads the key of the "${credential}" door, which resolves none`,
    );
  }
}

/** Whether the route asks its plan before its permission (Q31), at the credential's scope. */
function planFirst(route: RestTransportRoute<unknown>): boolean {
  return route.entitlement?.before === "permission";
}

/** Whether the door only identifies the caller, leaving the permission to be asked later. */
function identifiedFirst({
  route,
  credential,
}: {
  route: RestTransportRoute<unknown>;
  credential: RestDoorCredential;
}): boolean {
  if (route.access?.kind === "authenticated" || route.access?.kind === "deferred") return true;

  if (route.permissionPlatform || planFirst(route)) return true;

  return (
    Boolean(route.permissionBy) || (credential === "browser" && Boolean(route.permissionTarget))
  );
}

/**
 * A permission asked once the body is read needs the door's `authorize`; and a browser session
 * names no scope, so a choice asked at the credential's own scope would have none.
 */
function assertAfterBodyPorts({
  address,
  route,
  door,
  credential,
}: {
  address: string;
  route: RestTransportRoute<unknown>;
  door: RestIdentity;
  credential: RestDoorCredential;
}): void {
  if ((route.permissionTarget || route.permissionBy || planFirst(route)) && !door.authorize) {
    throw new Error(
      `REST ${address} checks "${routePermissions(route).join(", ")}" after its door, at a ` +
        "scope its input names, and this runtime supplied no identity.authorize",
    );
  }

  if (planFirst(route) && credential === "browser") {
    throw new Error(
      `REST ${address} asks its plan before its permission at the credential's own scope, and ` +
        "the browser door resolves none",
    );
  }

  if (!route.permissionBy || route.permissionTarget || credential !== "browser") return;

  const bare = Object.values(route.permissionBy.map).some((entry) => typeof entry === "string");

  if (!bare) return;

  throw new Error(
    `REST ${address} asks a permission its input chooses at the credential's own scope, and ` +
      "the browser door resolves none: name the scope on the entry or the route",
  );
}

/** A permission reach is the key door's question; behind any other door it has no answer. */
function assertReachDoor({
  address,
  route,
  credential,
}: {
  address: string;
  route: RestTransportRoute<unknown>;
  credential: RestDoorCredential;
}): void {
  if (!route.permissionReach || credential === "api_key") return;

  // The CLI token's scope is its organization, so asking there is what the door already does.
  if (credential === "cli_token" && route.permissionReach === "organization") return;

  throw new Error(
    `REST ${address} asks "${route.permission}" at the reach of a key's grants, and only ` +
      'the "api_key" door reads a key that names no project (the "cli_token" door takes ' +
      '{ at: "organization" })',
  );
}

/** The store behind each capability a route declared, named when it is missing. */
function assertCapabilityPorts({
  address,
  route,
  ports,
}: {
  address: string;
  route: RestTransportRoute<unknown>;
  ports: RestRuntimeMembers;
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
      `REST ${address} asks whether its tenant holds "${route.entitlement.entitlement}", ` +
        "and this runtime supplied no entitlements port to ask",
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
 * Every binding the declaration's middleware context needs, checked once at mount. A
 * context the module did not provide is refused here, naming it and the route,
 * rather than reaching a handler as an unset argument.
 */
function contextBindings<Api>({
  declaration,
  options,
}: {
  declaration: RestTransportDeclaration<Api>;
  options: RestMountOptions<Api>;
}): ReadonlyMap<string, MiddlewareContextBinding> {
  const bound = new Map(
    (options.middlewareContext ?? []).map(
      (binding) => [binding.middlewareContext, binding] as const,
    ),
  );

  for (const route of declaration.routes) {
    for (const declared of route.middleware ?? []) {
      if (declared.source === "headers") {
        bound.set(declared.name, {
          middlewareContext: declared.name,
          resolve: (request) => Object.fromEntries(request.headers),
        });

        continue;
      }

      if (bound.has(declared.name)) continue;

      throw new Error(
        `REST ${route.method.toUpperCase()} /api/${declaration.namespace}${route.path} declares ` +
          `the middleware context "${declared.name}", and its module provides no value for it`,
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
  contexts,
  version,
  status,
  paramSource = "route",
  documented = true,
}: {
  route: RestTransportRoute<Api>;
  declaration: RestTransportDeclaration<Api>;
  ports: RestRuntimeMembers;
  options: RestMountOptions<Api>;
  contexts: ReadonlyMap<string, MiddlewareContextBinding>;
  version: string;
  status: VersionStatus;
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
  const credential = route.credential ?? declaration.credential;
  const door = authenticateMiddleware({ route, credential, ports });
  const refusal = routeRefusal({ route, door: doorOf({ credential, ports }) });

  // Ahead of the validators: they read the body to parse it, and a stream
  // read once cannot be drained again to measure it.
  const cap = limit
    ? [
        bodyLimit({
          maxSize: limit.maxBytes,
          onError: () => {
            throw limit.onExceeded();
          },
        }),
      ]
    : [];

  const raw = route.rawBody ? [rawBodyMiddleware(route.rawBody)] : [];
  const named = route.rawBody ?? route.inputMediaType;
  const mismatch = named?.mismatch;
  const media =
    named && mismatch !== undefined && mismatch !== "accepted" ? [mediaTypeMiddleware(named)] : [];
  const refuses = route.rawBody?.refuses;
  const refused =
    route.rawBody && refuses
      ? [refusedMediaTypeMiddleware({ refuses, expected: route.rawBody.mediaType })]
      : [];

  return [
    ...legacyErrorScopes(route),
    ...(refusal ? [protocolRefusalScope({ route, refusal })] : []),
    versionContext({ route, family, version, status }),
    ...(documents
      ? [
          documentRoute({
            route,
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
    // The door answers before the cap drains a byte (main's order), unless it signs over the
    // body: then the capped bytes are read once, exactly as sent, and it verifies those.
    // The media type is asked after the door either way (E9): a missing credential answers 401.
    ...(doorReadsBody(route)
      ? [...cap, ...raw, door, ...media, ...refused]
      : [door, ...credentialContexts({ route, contexts }), ...media, ...refused, ...cap, ...raw]),
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
    ...bodyScopeValidator(route),
    inputMiddleware({ route, paramSource }),
    handlerMiddleware({
      route,
      credential,
      ports,
      options,
      contexts,
      family,
      version,
    }),
  ];
}

/** Who each request's door authenticated: `null` for nobody at an optional door. */
const callers = new WeakMap<Context, RestCaller | null>();

/** Whether the door verifies the raw body (a signed door), so reads it before it answers. */
function doorReadsBody(route: RestTransportRoute<unknown>): boolean {
  const kind = route.access?.kind;

  return route.rawBody !== undefined && (kind === "authenticated" || kind === "deferred");
}

/**
 * Who is calling, settled before the body is parsed or validated (Alex, 2026-09-30). Which
 * project the caller may act on is decided later, from the parsed input.
 */
function authenticateMiddleware({
  route,
  credential,
  ports,
}: {
  route: RestTransportRoute<unknown>;
  credential: RestDoorCredential;
  ports: RestRuntimeMembers;
}): MiddlewareHandler {
  return async (context, next) => {
    if (route.access?.kind !== "public") {
      const caller = await callerOf({
        route,
        door: doorOf({ credential, ports }),
        credential,
        request: context.req.raw,
        rawBody: context.get(ROUTE_RAW_BODY),
      });

      // The door is told the admitted kinds; the runtime still refuses one it let through.
      if (caller && route.keyKinds) {
        assertKeyKind({
          key: keyCredentialOfDoor({ door: "project", request: context.req.raw }),
          admitted: route.keyKinds,
        });
      }

      callers.set(context, caller);
    }

    await next();
  };
}

/** A public route's middleware context, read off the credential alone before the body (§8). */
const earlyContexts = new WeakMap<Context, ReadonlyMap<string, unknown>>();

/**
 * Credential, then body, then what the body names (Alex, 2026-09-30): a public route's
 * credential context refuses before its body is capped, parsed or validated. A capped door route
 * resolves them here too, since the cap replaces the request its door recorded the credential on.
 */
function credentialContexts({
  route,
  contexts,
}: {
  route: RestTransportRoute<unknown>;
  contexts: ReadonlyMap<string, MiddlewareContextBinding>;
}): MiddlewareHandler[] {
  const early = (route.middleware ?? []).filter((declared) => declared.source === undefined);

  if (early.length === 0 || (route.access?.kind !== "public" && !route.bodyLimit)) return [];

  return [
    async (context, next) => {
      const resolved = new Map<string, unknown>();

      for (const declared of early) {
        resolved.set(
          declared.name,
          await resolveBoundContext({ route, declared, contexts, context }),
        );
      }

      earlyContexts.set(context, resolved);
      await next();
    },
  ];
}

/** @see authenticateMiddleware, which every non-public route's stack runs first. */
function authenticatedCaller(context: Context): RestCaller | null {
  const caller = callers.get(context);

  if (caller === undefined) throw new Error("REST handler reached before its door answered");

  return caller;
}

/** The exact characters or bytes a route that parses nothing was sent. */
function rawBodyMiddleware(rawBody: RestRawBody): MiddlewareHandler {
  return async (context, next) => {
    if (rawBody.form === "stream") {
      context.set(ROUTE_RAW_BODY, context.req.raw.body);
      await next();

      return;
    }

    const bytes = new Uint8Array(await context.req.raw.arrayBuffer());

    context.set(ROUTE_RAW_BODY, rawBody.form === "text" ? TEXT.decode(bytes) : bytes);
    await next();
  };
}

const TEXT = new TextDecoder();

/** A Content-Type's essence, lower-cased and without parameters; null when none was sent. */
function mediaTypeEssence(contentType: string | undefined): string | null {
  const essence = contentType?.split(";")[0]?.trim().toLowerCase();

  return essence ? essence : null;
}

/** Refuses a body sent under a media type its route did not declare; reads one header, no bytes. */
function mediaTypeMiddleware(declared: RestRawBody | RestInputMediaType): MiddlewareHandler {
  return async (context, next) => {
    const received = mediaTypeEssence(context.req.header("content-type"));

    if (received !== declared.mediaType) {
      const refusal = { received, expected: declared.mediaType };

      throw declared.mismatch === "malformed_request"
        ? new MediaTypeMalformedRequestError(refusal)
        : new UnsupportedMediaTypeError(refusal);
    }

    await next();
  };
}

/** Refuses a body sent under a media type its route names, or that type with a `+suffix`. */
function refusedMediaTypeMiddleware({
  refuses,
  expected,
}: {
  refuses: readonly string[];
  expected: string;
}): MiddlewareHandler {
  return async (context, next) => {
    const received = mediaTypeEssence(context.req.header("content-type"));
    const isRefused = refuses.some(
      (refused) => received === refused || received?.startsWith(`${refused}+`),
    );

    if (received !== null && isRefused) {
      throw new UnsupportedMediaTypeError({ received, expected });
    }

    await next();
  };
}

/**
 * Every deprecated route is reported once per process, on its first call to a runtime that has
 * a log: a runtime without one does not mark the route, so it cannot swallow the report.
 */
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
  ports: RestRuntimeMembers;
}): MiddlewareHandler {
  const key = `${family} ${route.operation}`;

  return async (context, next) => {
    if (ports.deprecationLog && !reportedDeprecations.has(key)) {
      reportedDeprecations.add(key);

      ports.deprecationLog.deprecatedRouteCalled({
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

    const validate = refusingMalformedBody({
      target,
      validate: openApiValidator(target, schema, (result) => {
        // The typed refusal, raised here rather than left for a boundary to
        // recognise: a family with an `onError` of its own must not answer 500
        // for a request every other family answers 422 for.
        if (!result.success) {
          throw requestValidationErrorFrom({ target, error: result.error, input: result.data });
        }
      }),
    });

    const middleware = readingAbsentBody({ route, target, schema, validate });

    // An optional JSON body is published by the route's own document instead.
    if (!documented || (target === "json" && !requiresBody(schema))) {
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
  add("json", route.arrayBody?.schema ?? route.input);

  return stack;
}

/** The JSON body validator reads an absent body; multipart and raw-body routes read their own. */
function readingAbsentBody({
  route,
  target,
  schema,
  validate,
}: {
  route: RestTransportRoute<unknown>;
  target: "param" | "query" | "json";
  schema: z.ZodType;
  validate: MiddlewareHandler;
}): MiddlewareHandler {
  if (target !== "json" || route.multipart || route.rawBody) return validate;

  if (route.arrayBody) return absentBodyRefused({ validate });

  return absentBodyAsEmptyObject({ schema, validate });
}

/** A raw JSON body whose permission is asked at a project it names: parsed and validated here. */
function bodyScopeValidator(route: RestTransportRoute<unknown>): MiddlewareHandler[] {
  const target = route.permissionTarget;

  if (target?.at !== "body") return [];

  return [
    async (context, next) => {
      const raw: unknown = context.get(ROUTE_RAW_BODY);
      const parsed = parsedJson(typeof raw === "string" ? raw : "");

      if (!parsed.ok) throw new MalformedRequestError({ target: "json", detail: parsed.detail });

      const result = target.schema.safeParse(parsed.value);

      if (!result.success) {
        throw requestValidationErrorFrom({
          target: "json",
          error: result.error,
          input: parsed.value,
        });
      }

      context.set(ROUTE_BODY_SCOPE, result.data);
      await next();
    },
  ];
}

function parsedJson(
  text: string,
): Readonly<{ ok: true; value: unknown }> | Readonly<{ ok: false; detail: string }> {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * An absent body is read as the empty object (ARCHITECTURE.md §8), so a bodiless action keeps
 * working; any body that was sent, `null` and malformed ones included, is parsed as sent.
 */
function absentBodyAsEmptyObject({
  schema,
  validate,
}: {
  schema: z.ZodType;
  validate: MiddlewareHandler;
}): MiddlewareHandler {
  const middleware: MiddlewareHandler = async (context, next) => {
    if (!(await isBodyAbsent(context.req))) return validate(context, next);

    const parsed = schema.safeParse({});

    if (!parsed.success) {
      throw requestValidationErrorFrom({ target: "json", error: parsed.error, input: {} });
    }

    if (typeof parsed.data !== "object" || parsed.data === null) {
      throw new TypeError("REST body schemas must produce an object");
    }

    context.req.addValidatedData("json", parsed.data);
    await next();
  };

  // The route's OpenAPI input schema hangs off the validator; the document reads it back.
  return Object.assign(middleware, validate);
}

/** An array route is never a bodiless action, so an absent body is the 400 a broken one is. */
function absentBodyRefused({ validate }: { validate: MiddlewareHandler }): MiddlewareHandler {
  const middleware: MiddlewareHandler = async (context, next) => {
    if (!(await isBodyAbsent(context.req))) return validate(context, next);

    throw new MalformedRequestError({ target: "json", detail: "No body was sent" });
  };

  return Object.assign(middleware, validate);
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
    const sent = route.arrayBody ? { [route.arrayBody.as]: json } : json;
    const body = route.multipart ? context.get(ROUTE_FORM_FIELDS) : sent;

    const bodyTarget = route.multipart ? "form" : "json";

    context.set(ROUTE_INPUT, mergeInput({ params, query, body, bodyTarget }));
    await next();
  };
}

function mergeInput({
  params,
  query,
  body,
  bodyTarget,
}: {
  params: unknown;
  query: unknown;
  body: unknown;
  bodyTarget: "form" | "json";
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

    for (const key of Object.keys(part)) refuseRepeatedKey({ input, key, source, bodyTarget });

    Object.assign(input, part);
  }

  return input;
}

/** Declared sources never overlap (declaration.ts), so a body key that does was sent. */
function refuseRepeatedKey({
  input,
  key,
  source,
  bodyTarget,
}: {
  input: Record<string, unknown>;
  key: string;
  source: "path" | "query" | "body";
  bodyTarget: "form" | "json";
}): void {
  if (!Object.hasOwn(input, key)) return;

  if (source === "body") {
    throw new MalformedRequestError({
      target: bodyTarget,
      detail: `The body field "${key}" repeats a path or query field of the same name`,
    });
  }

  throw new TypeError(`REST input field "${key}" is declared by multiple sources`);
}

/** The organization's second-factor requirement, asked where the permit was (as tRPC does). */
async function assertRouteSecondFactor({
  caller,
  actor,
  scope,
  authorize,
}: {
  caller: RestCaller;
  actor: AccessActor | null;
  scope: AuthzDeclaredScopeId | null;
  authorize: Authorize;
}): Promise<void> {
  if (!scope) return;

  const browserSession = caller.browserSession ? { browserSession: caller.browserSession } : {};
  await assertSecondFactor({ caller: { actor, ...browserSession }, scope, authorize });
}

/** Authenticate, decide, handle, check the answer, respond. */
function decideRouteCaller<Api>({
  route,
  ports,
  options,
  context,
  caller,
  input,
}: {
  route: RestTransportRoute<Api>;
  ports: RestRuntimeMembers;
  options: RestMountOptions<Api>;
  context: Context;
  caller: RestCaller;
  input: unknown;
}) {
  return decide({
    declaration: {
      kind: "service-authorized",
      reason: route.access?.reason ?? options.reason ?? HOST_ENFORCED,
      permissions: routePermissions(route),
    },
    caller: { actor: normalizedActor(caller.actor), scope: caller.scope },
    input,
    authorize: ports.authorization.forRequest(context.req.raw),
    ...(ports.denials ? { denials: ports.denials } : {}),
  });
}

function handlerMiddleware<Api>({
  route,
  credential,
  ports,
  options,
  contexts,
  family,
  version,
}: {
  route: RestTransportRoute<Api>;
  credential: RestDoorCredential;
  ports: RestRuntimeMembers;
  options: RestMountOptions<Api>;
  contexts: ReadonlyMap<string, MiddlewareContextBinding>;
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
        ...(await resolveContexts({ route, contexts, context, input })),
      );

      return answerWith({ context, next, route, result });
    }

    const door = doorOf({ credential, ports });
    const caller = authenticatedCaller(context);

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
        ...(await resolveContexts({ route, contexts, context, input })),
      );

      return answerWith({ context, next, route, result: anonymous });
    }

    const decision = await decideRouteCaller({ route, ports, options, context, caller, input });

    if (route.mintsCredential) {
      refuseImpersonatedMint({
        permission: route.mintsCredential,
        actor: decision.actor,
        scope: decision.scope,
        address: `REST ${family}.${route.operation}`,
      });
    }

    // Plan first (Q31): the door only identified, so the plan is asked at its scope.
    if (planFirst(route)) {
      await checkEntitlement({ route, ports, scope: decision.scope, input, family });
    }

    const target = await checkRouteScope({ route, caller, door, ports, input, context });
    const capabilities = { route, ports, context, family, version, caller, input } as const;

    // The scope access resolved: the one a route's own path named when it named
    // one, and the door's own otherwise. Both the plan question and the
    // idempotency tenancy are asked about exactly this scope.
    const resolved = target ?? decision.scope;
    const authorize = ports.authorization.forRequest(context.req.raw);

    await assertRouteSecondFactor({ caller, actor: decision.actor, scope: resolved, authorize });

    if (!planFirst(route)) await checkEntitlement({ route, ports, scope: resolved, input, family });
    await refuseAggregateWrite({ route, ports, scope: resolved, request: context.req.raw });

    await countCall(capabilities);

    // After the door, never before it: a caller who may not read this cannot
    // be handed the bytes an entitled one left behind.
    const stored = await storedAnswer(capabilities);

    if (stored) return stored;

    const actor = doorActorOf({ credential, actor: decision.actor });
    const authorization = await mintAuthorization({
      permission: route.permission,
      actor: actor ?? ownerlessKeyProofActor({ credential, request: context.req.raw, resolved }),
      scope: resolved,
      authorize,
      route: `${family}.${route.operation}`,
    });

    const run = async (): Promise<Response | undefined> => {
      const result = await auditing({
        route,
        ports,
        actor,
        credential,
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
              authorization,
              session: sessionOf({ route, credential, caller }),
              key: keyOf({ route, credential, request: context.req.raw }),
            }),
            ...(await resolveContexts({ route, contexts, context, input })),
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
 * ADR-177 decision 8, asked as the tRPC door asks it of a mutation: a request that writes, under
 * a permission that writes under its project, is refused on an aggregate. Reads pay no kind read.
 */
async function refuseAggregateWrite({
  route,
  ports,
  scope,
  request,
}: {
  route: RestTransportRoute<unknown>;
  ports: RestRuntimeMembers;
  scope: AuthzDeclaredScopeId | null;
  request: Request;
}): Promise<void> {
  const permissions = routePermissions(route);
  const refusedOnAggregate = route.refusedOnAggregate === true;
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  if (!asksAggregateWrite({ permissions, scope, refusedOnAggregate })) return;

  const authorize = ports.authorization.forRequest(request);
  refuseWriteUnderAggregate({
    permissions,
    scope: await scopeWithOrganization({ scope, authorize }),
    refusedOnAggregate,
  });
}

/**
 * The trail a route declared. Written from the actor, path parameters, and answer id;
 * refusals write the same row with the handled error's code. Routes with no declared
 * action run untouched; this function is the only place that decides whether a row is written.
 */
async function auditing<TResult>({
  route,
  ports,
  actor,
  credential,
  scope,
  context,
  run,
}: {
  route: RestTransportRoute<unknown>;
  ports: RestRuntimeMembers;
  actor: Actor | null;
  credential: RestDoorCredential;
  scope: AuthzDeclaredScopeId | null;
  context: Context;
  run: () => Promise<TResult>;
}): Promise<TResult> {
  const action = route.audit;

  if (!action) return run();

  const sink = requireAudit(ports);
  const params = auditParams({ route, context });
  const caller = auditCaller({ actor, credential, request: context.req.raw });

  try {
    const result = await run();

    await sink.record({ ...caller, action, scope, params, resultId: resultIdOf(result) });

    return result;
  } catch (error) {
    if (error instanceof HandledError) {
      await sink.record({
        ...caller,
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
 * Who a row names (E11): the actor, the operator behind an impersonated call,
 * the key the call presented, and where it came from as the door resolved it.
 */
function auditCaller({
  actor,
  credential,
  request,
}: {
  actor: Actor | null;
  credential: RestDoorCredential;
  request: Request;
}) {
  const named = normalizedActor(actor);
  const impersonatorId = named?.type === "user" ? named.impersonatorId : void 0;
  const doorKeyId = isKeyDoor(credential)
    ? recordedKeyOfDoor({ door: credential, request })?.apiKeyId
    : null;
  const apiKeyId = named?.type === "api_key" ? named.id : doorKeyId;
  const ipAddress = ClientAddress.resolvedFor(request);
  const userAgent = request.headers.get("user-agent");

  return {
    actorId: named?.type === "user" ? named.id : null,
    ...(impersonatorId ? { impersonatorId } : {}),
    ...(apiKeyId ? { apiKeyId } : {}),
    ...(ipAddress ? { ipAddress } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
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
function requireAudit(ports: RestRuntimeMembers): RestAuditSink {
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
  input,
  family,
}: {
  route: RestTransportRoute<unknown>;
  ports: RestRuntimeMembers;
  scope: AuthzDeclaredScopeId | null;
  input: unknown;
  family: string;
}): Promise<void> {
  if (!route.entitlement || !ports.entitlements) return;

  await decideEntitlement({
    gate: route.entitlement,
    scope,
    input,
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
  ports: RestRuntimeMembers;
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
  ports: RestRuntimeMembers;
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

  const limit =
    route.rateLimit.requests !== undefined && route.rateLimit.seconds !== undefined
      ? { requests: route.rateLimit.requests, seconds: route.rateLimit.seconds }
      : undefined;

  const verdict = await ports.rateLimiter.check(key, limit);

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
  ports: RestRuntimeMembers;
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
  ports: RestRuntimeMembers;
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

/** The door's session as the route's schema reads it; one it refuses is no credential. */
function sessionOf({
  route,
  credential,
  caller,
}: {
  route: { session?: z.ZodType };
  credential: Credential;
  caller: RestCaller;
}): unknown {
  if (!route.session) return undefined;
  const parsed = route.session.safeParse(caller.session);
  if (!parsed.success) throw new SurfaceUnverifiedError(credential);

  return parsed.data;
}

/** The key the door recorded, for a route that declared its handler reads it (E5). */
function keyOf({
  route,
  credential,
  request,
}: {
  route: RestTransportRoute<unknown>;
  credential: RestDoorCredential;
  request: Request;
}): RestKeyCredential | undefined {
  if (!route.key || !isKeyDoor(credential)) return undefined;

  return keyCredentialOfDoor({ door: credential, request });
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
  authorization = null,
  session,
  key,
}: {
  context: Context;
  route: RestTransportRoute<Api>;
  options: RestMountOptions<Api>;
  input: unknown;
  actor: Actor | null;
  scope: AuthzDeclaredScopeId | null;
  target: AuthzDeclaredScopeId | null;
  authorization?: Authorization | null;
  session?: unknown;
  key?: RestKeyCredential | undefined;
}): StoredHandlerArguments<Api> {
  return {
    app: options.app(),
    input,
    actor,
    scope,
    target,
    authorization,
    session,
    key,
    signal: context.req.raw.signal,
    request: context.req.raw,
    raw: route.rawBody
      ? (context.get(ROUTE_RAW_BODY) as string | Uint8Array | ReadableStream<Uint8Array> | null)
      : undefined,
    files: route.multipart
      ? (context.get(ROUTE_FILES) as Readonly<Record<string, File>>)
      : undefined,
    response: route.response
      ? producerFor({ kind: route.response.kind, accept: context.req.header("Accept") ?? "" })
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
  if (route.response) {
    if (!isDeclined(result)) return respondProduced({ context, route, result });
  } else if (!route.rawResponse) {
    return respond({ context, route, result });
  } else if (!isDeclined(result)) {
    return respondRaw({ context, route, result });
  }

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
function headerScopeInput(
  route: RestTransportRoute<unknown>,
  context: Context,
  target: Readonly<{ param: string; header: string }>,
): Record<string, unknown> {
  const declared = route.middleware?.find((candidate) => candidate.source === "headers");

  if (!declared) throw new Error(`REST ${route.operation} has no declared header schema`);

  const headers = resolveHeaderContext(declared, context);

  if (typeof headers !== "object" || headers === null)
    throw new Error(`REST ${route.operation} header schema returned no object`);

  return { [target.param]: Reflect.get(headers, target.header) };
}

/** The fields the route's permission target reads its scope from, wherever it is located. */
function permissionScopeInput({
  route,
  target,
  input,
  context,
}: {
  route: RestTransportRoute<unknown>;
  target: RestPermissionTarget;
  input: unknown;
  context: Context;
}): unknown {
  if (target.at === "header") return headerScopeInput(route, context, target);
  if (target.at === "body") return bodyScopeInput(target, context);

  return pathScopeInput(target, input);
}

/** The scope a raw JSON body names, read from the body its location validated. */
function bodyScopeInput(
  target: Readonly<{ param: string; field?: string }>,
  context: Context,
): Record<string, unknown> {
  const body: unknown = context.get(ROUTE_BODY_SCOPE);
  const value =
    typeof body === "object" && body !== null
      ? Reflect.get(body, target.field ?? target.param)
      : void 0;

  return { [target.param]: value };
}

/** The route's input, with the scope its path spells under another name read as the tier's own. */
function pathScopeInput(
  target: Readonly<{ param: string; field?: string }>,
  input: unknown,
): unknown {
  if (target.field === undefined || typeof input !== "object" || input === null) return input;

  return { [target.param]: Reflect.get(input, target.field) };
}

function resolveHeaderContext(declared: MiddlewareContext, context: Context): unknown {
  const cached: Map<string, unknown> =
    context.get(ROUTE_HEADER_CONTEXT) ?? new Map<string, unknown>();

  if (cached.has(declared.name)) return cached.get(declared.name);

  const parsed = declared.schema.safeParse(Object.fromEntries(context.req.raw.headers.entries()));

  if (!parsed.success) throw requestValidationErrorFrom({ target: "header", error: parsed.error });

  cached.set(declared.name, parsed.data);
  context.set(ROUTE_HEADER_CONTEXT, cached);

  return parsed.data;
}

async function checkRouteScope({
  route,
  caller,
  door,
  ports,
  input,
  context,
}: {
  route: RestTransportRoute<unknown>;
  caller: RestCaller;
  door: RestIdentity;
  ports: RestRuntimeMembers;
  input: unknown;
  context: Context;
}): Promise<AuthzDeclaredScopeId | null> {
  const asked = askedAfterBody({ route, caller, input, context });

  if (!asked) return null;

  const authorize = ports.authorization.forRequest(context.req.raw);
  for (const permission of asked.permissions) {
    const decision = await requireAuthorize(door)({ caller, permission, target: asked.target });

    assertRouteScopePermission({
      permission,
      target: asked.target,
      decision: await gatedDecision({ decisions: authorize, scope: asked.target, decision }),
      ...(ports.denials ? { denials: ports.denials } : {}),
    });
  }

  return asked.named ? asked.target : null;
}

/**
 * What is asked once the body is read, in order, and where: the permissions a route asks at
 * the scope its own path names, or the one its input chose. `named` is false when that scope
 * is the credential's own, which the handler is handed as its scope rather than its target.
 */
function askedAfterBody({
  route,
  caller,
  input,
  context,
}: {
  route: RestTransportRoute<unknown>;
  caller: RestCaller;
  input: unknown;
  context: Context;
}): Readonly<{
  permissions: readonly AuthzPermission[];
  target: AuthzDeclaredScopeId;
  named: boolean;
}> | null {
  const chosen = route.permissionBy
    ? chosenPermission({ declared: route.permissionBy, input })
    : null;

  if (chosen?.scope) return { permissions: [chosen.permission], target: chosen.scope, named: true };

  const permissions = chosen ? [chosen.permission] : routePermissions(route);

  if (route.permissionTarget) {
    const scopeInput = permissionScopeInput({
      route,
      target: route.permissionTarget,
      input,
      context,
    });
    const target = routeScopeOf({ param: route.permissionTarget.param, input: scopeInput });

    return { permissions, target, named: true };
  }

  if (!chosen && !planFirst(route)) return null;

  if (!caller.scope) throw new Error(`REST ${route.operation} chose a permission with no scope`);

  return { permissions, target: caller.scope, named: false };
}

/**
 * Which question this route's access kind asks of the family's door: the
 * permission the route named, the door alone, or the door for a caller who may
 * have presented nothing - the one question that can answer with nobody.
 */
async function callerOf({
  route,
  door,
  credential,
  request,
  rawBody,
}: {
  rawBody?: string | Uint8Array;
  credential: RestDoorCredential;
  route: RestTransportRoute<unknown>;
  door: RestIdentity;
  request: Request;
}): Promise<RestCaller | null> {
  const kind = route.access?.kind;

  if (route.permissionPlatform) {
    return platformCallerOf({ door, request, platform: route.permissionPlatform });
  }

  if (credential === "browser" && route.permissionTarget) return requireIdentify(door)({ request });

  // Chosen from the input, so asked once the body is read; the door only says who is calling.
  if (route.permissionBy) {
    return requireIdentify(door)({ request, ...(rawBody === void 0 ? {} : { rawBody }) });
  }

  if (anonymousOnRefusal(route)) return anonymousCallerOf({ door, request });

  if (kind === "optional") return requireIdentifyOptional(door)({ request });

  if (kind === "authenticated" || kind === "deferred" || planFirst(route))
    return requireIdentify(door)({ request, ...(rawBody === void 0 ? {} : { rawBody }) });

  return door.authenticate({
    request,
    permission: permissionOf(route.permission),
    permissions: routePermissions(route),
    ...(route.permissionReach ? { reach: route.permissionReach } : {}),
    ...(route.keyKinds ? { keyKinds: route.keyKinds } : {}),
  });
}

/** Whether the route answers a credential its door refuses as no credential at all. */
function anonymousOnRefusal(route: RestTransportRoute<unknown>): boolean {
  return route.access?.kind === "optional" && route.access.refused === "anonymous";
}

/** The logger an anonymous-on-refusal door reports a failure that is not a refusal through. */
const anonymousDoorLogger = createLogger("langwatch:api:anonymous-door");

/**
 * The caller the door verifies, or nobody: a missing, refused or unverifiable credential is
 * answered as none, so the route still serves. A failure that is not a refusal is logged
 * (Alex 2026-10-10 W02-INTAKE-OUTAGE).
 */
async function anonymousCallerOf({
  door,
  request,
}: {
  door: RestIdentity;
  request: Request;
}): Promise<RestCaller | null> {
  try {
    return await requireIdentify(door)({ request });
  } catch (error) {
    if (!HandledError.isHandled(error)) {
      anonymousDoorLogger.warn({ error }, "the door failed; answering the caller as anonymous");
    }
    return null;
  }
}

/**
 * Who calls a platform route (E4): the door identifies, then answers the platform question.
 * A hidden route answers every refusal, a missing session's included, with the same 404.
 */
async function platformCallerOf({
  door,
  request,
  platform,
}: {
  door: RestIdentity;
  request: Request;
  platform: PlatformPermissionDeclaration;
}): Promise<RestCaller> {
  const caller = await Promise.resolve(requireIdentify(door)({ request })).catch(
    (error: unknown) => {
      const refused = error instanceof HandledError && error.httpStatus < 500;
      throw refused && platform.refusal === "hidden" ? platformRefusal(platform) : error;
    },
  );

  await decidePlatform({
    declaration: platform,
    actor: caller.actor,
    ask: ({ permission }) => requireAuthorizePlatform(door)({ caller, permission }),
  });

  return caller;
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
  ports: RestRuntimeMembers;
}): RestDoor {
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

/** @see assertDoorQuestions, which refuses this before a request arrives. */
function requireAuthorizePlatform(
  door: RestIdentity,
): NonNullable<RestIdentity["authorizePlatform"]> {
  const authorizePlatform = door.authorizePlatform;

  if (!authorizePlatform) throw new Error("REST runtime supplied no identity.authorizePlatform");

  return authorizePlatform.bind(door);
}

/** @see assertPortsBound, which refuses these before a request arrives. */
function requireAuthorize(door: RestIdentity): NonNullable<RestIdentity["authorize"]> {
  const authorize = door.authorize;

  if (!authorize) throw new Error("REST runtime supplied no identity.authorize");

  return authorize.bind(door);
}

/**
 * The declared middleware context, in declaration order, each parsed by the schema that
 * declared it. Resolved after the access decision, so a refused request never
 * asks the process for anything.
 */
async function resolveContexts({
  route,
  contexts,
  context,
  input,
}: {
  route: RestTransportRoute<unknown>;
  contexts: ReadonlyMap<string, MiddlewareContextBinding>;
  context: Context;
  input: unknown;
}): Promise<unknown[]> {
  const resolved: unknown[] = [];

  for (const declared of route.middleware ?? []) {
    if (declared.source === "headers") {
      resolved.push(resolveHeaderContext(declared, context));
      continue;
    }

    const early = earlyContexts.get(context);

    resolved.push(
      early?.has(declared.name)
        ? early.get(declared.name)
        : await resolveBoundContext({ route, declared, contexts, context, input }),
    );
  }

  return resolved;
}

async function resolveBoundContext({
  route,
  declared,
  contexts,
  context,
  input,
}: {
  route: RestTransportRoute<unknown>;
  declared: MiddlewareContext;
  contexts: ReadonlyMap<string, MiddlewareContextBinding>;
  context: Context;
  /** The validated input, for a context declared `source: "input"`; absent before the body. */
  input?: unknown;
}): Promise<unknown> {
  const binding = contexts.get(declared.name);

  if (!binding) {
    throw new Error(
      `REST ${route.operation} declares the middleware context "${declared.name}" and none is provided`,
    );
  }

  const parsed = declared.schema.safeParse(await binding.resolve(context.req.raw, input));

  if (!parsed.success) throw parsed.error;

  return parsed.data;
}

function normalizedActor(actor: Actor | null): (Actor & { id: string }) | null {
  if (!actor) return null;

  const parsed = actorSchema.parse(actor);

  return "id" in parsed && typeof parsed.id === "string"
    ? (parsed as Actor & { id: string })
    : null;
}

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
    const named = credential === "internal_secret" ? caller.internal !== undefined : true;

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
  return credential !== "browser" && DOOR_SCOPE_TIER[credential] === null ? null : actor;
}

/**
 * A project key that stands for nobody proves its own project's read as the door's own,
 * as main did; the door already asked the key's access. Nothing else gets an actor here.
 */
function ownerlessKeyProofActor({
  credential,
  request,
  resolved,
}: {
  credential: RestDoorCredential;
  request: Request;
  resolved: AuthzDeclaredScopeId | null;
}): Actor | null {
  if (credential !== "project" || resolved?.tier !== "project") return null;

  return admittedOwnerlessProjectKeyFor({ request, projectId: resolved.id })
    ? internalActor(OWNERLESS_PROJECT_KEY_PROOF_CODE_PATH)
    : null;
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

    throw new Error(
      `REST ${context.req.method} ${context.req.path} answered a value its declared output schema refuses`,
    );
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
 * The answer a declared kind's producer made. The handler could make no other:
 * the runtime's own check here is for a handler that reached the framework
 * some way the compiler could not see.
 */
function respondProduced({
  context,
  route,
  result,
  kind: declared = route.response?.kind,
}: {
  context: Context;
  route: RestTransportRoute<unknown>;
  result: unknown;
  /** The kind the answer must be: the route's own, or a refusal's protocol. */
  kind?: RestResponseKind | undefined;
}): Response {
  if (!isProducedAnswer(result)) {
    throw new Error(
      `REST ${route.operation} declares a ${declared} answer and returned something ` +
        "no response producer made",
    );
  }

  const kind = producedKind(result);

  if (kind !== declared) {
    throw new Error(
      `REST ${route.operation} declares a ${declared} answer and produced a ${kind} one`,
    );
  }

  if (result.body.form === "response") return result.body.response;

  const headers = { ...result.headers };
  const carrying = contentfulStatus(result.status);

  // Hono answers HEAD from the GET route, so the twin's body is dropped here
  // rather than left for a garbage collector to close.
  if (context.req.method === "HEAD" || carrying === null) {
    if (result.body.form === "stream") void result.body.stream.cancel();

    return context.body(null, result.status, carrying === null ? contentless(headers) : headers);
  }

  if (result.body.form === "events") {
    return context.body(eventStreamOf(result.body.events), carrying, headers);
  }

  if (result.body.form === "stream") return context.body(result.body.stream, carrying, headers);

  const bytes = result.body.bytes;

  return bytes === null
    ? context.body(null, result.status, headers)
    : context.body(bytes, carrying, headers);
}

/** An answer that carries no content names no media type for it. */
function contentless(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => name.toLowerCase() !== "content-type"),
  );
}

/** The statuses that carry no body at all, so nothing may be written under them. */
function contentfulStatus(status: StatusCode): ContentfulStatusCode | null {
  if (status === 101 || status === 204 || status === 205 || status === 304) return null;

  return status;
}

/**
 * The framing of a server-sent event stream, which is the framework's job and
 * not a handler's: one `data:` line per line of the payload, the optional
 * fields before it, and a blank line ending every event.
 */
function eventStreamOf(events: AsyncIterable<RestEvent>): ReadableStream {
  const encoder = new TextEncoder();
  const reading = events[Symbol.asyncIterator]();

  return new ReadableStream({
    async pull(controller) {
      const next = await reading.next();

      if (next.done === true) {
        controller.close();

        return;
      }

      controller.enqueue(encoder.encode(frameOf(next.value)));
    },
    // A caller that hung up ends the handler's own loop, rather than leaving it
    // producing events with nowhere to put them.
    async cancel(reason: unknown) {
      await reading.return?.(reason);
    },
  });
}

/** One event on the wire: its optional fields, then a `data:` line per line. */
function frameOf(event: RestEvent): string {
  const fields = [
    ...(event.id === undefined ? [] : [`id: ${event.id}`]),
    ...(event.event === undefined ? [] : [`event: ${event.event}`]),
    ...(event.retryMs === undefined ? [] : [`retry: ${event.retryMs}`]),
    ...event.data.split("\n").map((line) => `data: ${line}`),
  ];

  return `${fields.join("\n")}\n\n`;
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
  const answer = result as {
    status?: unknown;
    body?: unknown;
    headers?: Readonly<Record<string, string>>;
  };

  const status = typeof answer?.status === "number" ? answer.status : undefined;
  const schema = status === undefined ? undefined : answers[status];

  if (!schema || status === undefined) {
    throw new Error(
      `REST ${route.operation} answered with the status ${String(status)}, which it did not ` +
        `declare; responds() named ${Object.keys(answers).join(", ")}`,
    );
  }

  const validation = schema.safeParse(answer.body);
  for (const [name, value] of Object.entries(answer.headers ?? {})) context.header(name, value);

  if (status === 204 || status === 304) return context.body(null, status);

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

    throw new Error(
      `REST ${route.operation} answered a body its declared ${String(status)} schema refuses`,
    );
  }

  // The declared status IS the answer, whatever its class, so the request
  // record reads as one rather than as a server fault.
  context.set(DECLARED_ANSWER, true);

  return context.json(validation.data as never, status as ContentfulStatusCode);
}

/**
 * The version namespace: any real date the caller pins dispatches to the latest
 * registration on or before it. A version no mounted family serves answers 404
 * rather than falling through to a dynamic route.
 */
function mountVersionGuards<Api>({
  app,
  basePath,
  declaration,
  ports,
  options,
  contexts,
}: {
  app: Hono;
  basePath: string;
  declaration: RestTransportDeclaration<Api>;
  ports: RestRuntimeMembers;
  options: RestMountOptions<Api>;
  contexts: ReadonlyMap<string, MiddlewareContextBinding>;
}): void {
  const namespace = VERSION_NAMESPACE;
  const fallback = dateFallback({ basePath, declaration, ports, options, contexts });
  const notFound: MiddlewareHandler = async (context, next) =>
    anotherFamilyServesTheVersion(context) ? next() : context.notFound();

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
  contexts,
}: {
  basePath: string;
  declaration: RestTransportDeclaration<Api>;
  ports: RestRuntimeMembers;
  options: RestMountOptions<Api>;
  contexts: ReadonlyMap<string, MiddlewareContextBinding>;
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
      contexts,
      version: declaration.version,
      status: "stable",
      paramSource: "context",
      documented: false,
    }),
  }));

  const pick = (context: Context, routePath: string) => {
    const requested = versionAsked(context, routePath);

    if (!isDateVersion(requested) || requested < declaration.version) return undefined;

    // The guard is mounted under both prefixes, so the base to strip comes
    // from the route that matched rather than from the family's bare path.
    const marker = routePath.indexOf("/:apiVersion");
    const mountBase = marker >= 0 ? routePath.slice(0, marker) : basePath;
    const rest = context.req.path.slice(mountBase.length + requested.length + 1) || "/";
    const method = context.req.method.toLowerCase() as HttpMethod;
    const found = candidateFor({ candidates, method, rest });

    return found ? { requested, ...found } : undefined;
  };

  const fallback: MiddlewareHandler = async (context, next) => {
    const picked = pick(context, context.req.routePath);

    if (!picked) return next();

    context.set(ROUTE_PARAMS, picked.params);
    context.set(VERSION_REQUEST, picked.requested);

    const response = await runStack(picked.stack, context);

    return response ?? next();
  };

  datedFallbacks.set(fallback, (context, routePath) => pick(context, routePath) !== undefined);

  return fallback;
}

/** Each family's date fallback, asked whether it would serve a request without running it. */
const datedFallbacks = new WeakMap<object, (context: Context, routePath: string) => boolean>();

/**
 * Whether a family mounted after this guard serves the versioned address: a route
 * declared at that very version, or another family's date fallback.
 */
function anotherFamilyServesTheVersion(context: Context): boolean {
  const position = versionPosition(context.req.routePath);
  const requested = versionAsked(context, context.req.routePath);
  const later = matchedRoutes(context).slice(context.req.routeIndex + 1);

  return later.some(
    (route) => servesAtVersion({ route, position, requested }) || fallbackServes(context, route),
  );
}

/** A route declared at the very version asked for, not a dynamic segment standing in for it. */
function servesAtVersion({
  route,
  position,
  requested,
}: {
  route: RouterRoute;
  position: number;
  requested: string;
}): boolean {
  if (!servesTheRequest(route)) return false;

  return route.path.split("/")[position] === requested;
}

function fallbackServes(context: Context, route: RouterRoute): boolean {
  return datedFallbacks.get(handlerOf(route))?.(context, route.path) === true;
}

/** The version segment of the request, read at the place a guard's path declares it. */
function versionAsked(context: Context, routePath: string): string {
  return context.req.path.split("/")[versionPosition(routePath)] ?? "";
}

function versionPosition(routePath: string): number {
  return routePath.split("/").findIndex((segment) => segment.startsWith(":apiVersion"));
}

/** The first candidate serving the method at the path, with the params it read. */
function candidateFor<Candidate extends Readonly<{ pattern: string; stack: MiddlewareHandler[] }>>({
  candidates,
  method,
  rest,
}: {
  candidates: readonly (Candidate &
    Readonly<{ methods: readonly HttpMethod[]; anyMethod: boolean }>)[];
  method: HttpMethod;
  rest: string;
}): { params: Record<string, string>; stack: MiddlewareHandler[] } | undefined {
  for (const candidate of candidates) {
    if (!serves(candidate, method)) continue;

    const params = matchPath(candidate.pattern, rest);

    if (params) return { params, stack: candidate.stack };
  }

  return undefined;
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
 * twin. The document names the operation once, at the twin, the URL an
 * integrator is told to call; the bare address answers undescribed.
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
  sharedPath,
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
  sharedPath?: RegisteredSharedPath;
  served: Map<string, Set<HttpMethod>>;
}): void {
  // A literal family has no base to merge: its route path is the address.
  const absolute = basePath === "" ? path : mergePath(basePath, path);
  const alias = v1Twin ? canonicalV1Path(absolute) : null;
  const methods = route.methods ?? [route.method];
  const addresses = alias ? [absolute, alias] : [absolute];

  register({ app, route, methods, path: absolute, stack: alias ? undescribedStack(stack) : stack });

  if (alias) register({ app, route, methods, path: alias, stack });

  for (const method of route.anyMethod ? ["all"] : methods) {
    registerRoutePolicy({
      method,
      path: absolute,
      ...(alias ? { canonicalPath: alias } : {}),
      policy,
      family,
      credentialClass,
      credential,
      ...(sharedPath ? { sharedPath } : {}),
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
    app.all(path, answersEveryMethod(), ...handlers);

    return;
  }

  for (const method of methods) {
    // Hono exposes no `.head` shortcut, and HEAD is answered from the GET route
    // before routing, so that registration is for the registry and the document.
    if (method === "head") app.on("HEAD", path, ...handlers);
    else app[method](path, ...handlers);
  }
}

/** The guards and any-method routes mounted, told apart from middleware by identity. */
const methodGuards = new WeakMap<object, ReadonlySet<HttpMethod>>();
const anyMethodRoutes = new WeakSet<object>();

/** Marks an any-method route, so no family's method guard answers in front of it. */
function answersEveryMethod(): MiddlewareHandler {
  const marker: MiddlewareHandler = async (_context, next) => next();

  anyMethodRoutes.add(marker);

  return marker;
}

/**
 * A method no mounted route serves on this path: 405, `Allow` naming what every family
 * serves on it. The router's own match decides, so mount order never shadows a family.
 */
function mountMethodGuards({
  app,
  served,
}: {
  app: Hono;
  served: ReadonlyMap<string, Set<HttpMethod>>;
}): void {
  for (const [path, methods] of served) {
    const guard: MiddlewareHandler = async (context, next) => {
      const routes = matchedRoutes(context);
      const answered = routes.some(
        (route) => servesTheRequest(route) || fallbackServes(context, route),
      );

      if (answered) return next();

      context.header("Allow", allowHeaderOf(new Set(routes.flatMap(guardedMethods))));

      return context.body(null, 405);
    };

    methodGuards.set(guard, methods);
    app.all(path, guard);
  }
}

/** The router matches a route by its own method or `ALL`; HEAD is matched as GET. */
function servesTheRequest(route: RouterRoute): boolean {
  return route.method !== "ALL" || anyMethodRoutes.has(handlerOf(route));
}

function guardedMethods(route: RouterRoute): HttpMethod[] {
  return [...(methodGuards.get(handlerOf(route)) ?? [])];
}

/** The handler as mounted: `route()` wraps a sub-app's handler to carry its error boundary. */
function handlerOf(route: RouterRoute): object {
  return unwrapped(route.handler);
}

function unwrapped(handler: object): object {
  const inner: unknown = Reflect.get(handler, COMPOSED_HANDLER);

  return typeof inner === "function" ? unwrapped(inner) : handler;
}

/** What the path serves, as `Allow` spells it; HEAD rides on GET, as Hono serves it. */
function allowHeaderOf(methods: ReadonlySet<HttpMethod>): string {
  const named = new Set(methods);

  if (named.has("get")) named.add("head");

  return [...named]
    .map((method) => method.toUpperCase())
    .toSorted()
    .join(", ");
}

const HANDLER_CREDENTIAL = {
  project: "apiKey",
  organization: "apiKey",
  api_key: "apiKey",
  scim_token: "apiKey",
  instance_admin: "apiKey",
  session_key: "apiKey",
  cli_token: "apiKey",
  otlp_ingest: "apiKey",
  licence_token: "apiKey",
  browser: "session",
  internal_secret: "internal",
} as const satisfies Record<Exclude<Credential, "public">, HandlerCredential>;

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
    permissions: routePermissions(route),
  });
}

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
