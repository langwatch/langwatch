/**
 * The one REST execution path: parse, authenticate, decide, handle, check the
 * answer, respond. The request is parsed BEFORE the credential is resolved, so
 * a malformed body is refused without ever touching the caller's key.
 */

// A route answers at three addresses — its dated namespace, `latest`, and the
// family's bare path — plus the `/api/v1` twin of each, and any real date the
// caller pins dispatches to the latest registration on or before it.
import { actorSchema, type Actor } from "@langwatch/actor";
import type { AuthzDeclaredScopeId, AuthzPermission } from "@langwatch/authz-contract";
import { createLogger, validationMeta } from "@langwatch/observability";
import type { Context, ErrorHandler, Hono as HonoApp, MiddlewareHandler } from "hono";
import { Hono } from "hono";
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
  decide,
  type AccessDenialPort,
  type AuthorizePort,
  type Credential,
} from "../access/access.ts";
import { bodyLimit } from "./body-limit.ts";
import { loggerMiddleware, tracerMiddleware } from "./middleware.ts";
import { documentRoute } from "./rest-openapi.ts";
import type { RestTransportDeclaration, RestTransportRoute } from "./rest-router.ts";
import { registerRoutePolicy } from "./security/route-registry.ts";
import { ENDPOINT_ROUTE, isDateVersion, REQUEST_FAMILY, VERSION_LATEST } from "./types.ts";
import type { HttpMethod, VersionStatus } from "./types.ts";
import { canonicalV1Path, undescribedStack } from "./v1-alias.ts";
import { requestValidationErrorFrom } from "./validation.ts";

const outputLogger = createLogger("langwatch:api:output-validation");

const ROUTE_PARAMS = "routeParams" as const;
const VERSION_REQUEST = "apiVersionRequest" as const;
const ROUTE_INPUT = "endpointInput" as const;

/** Who the family's own door authenticated, and what its credential resolved. */
export type RestCaller = Readonly<{
  actor: Actor | null;
  scope: AuthzDeclaredScopeId;
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
  }>;
  /** Only a family whose routes carry a check of their own supplies these. */
  authorization?: Readonly<{ forRequest(request: Request): AuthorizePort }>;
  denials?: AccessDenialPort;
}>;

/** What one family's mount states beyond its declaration. */
export type RestMountOptions<Api> = Readonly<{
  app: () => Api;
  /** Which credential reaches these routes, as the document names it. */
  credential: Credential;
  /** The family's own error boundary: it renders every refusal these routes raise. */
  onError: ErrorHandler;
  /** Applied under the family's paths before any route: the app container. */
  middleware?: readonly MiddlewareHandler[];
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
      const basePath = `/api/${declaration.namespace}`;
      const app = new Hono();
      const aliasPath = canonicalV1Path(basePath);
      const scopes = aliasPath ? [`${basePath}/*`, `${aliasPath}/*`] : [`${basePath}/*`];

      for (const middleware of [
        tracerMiddleware({ name: declaration.namespace }),
        loggerMiddleware({ name: declaration.namespace }),
        ...(options.middleware ?? []),
      ]) {
        for (const scope of scopes) app.use(scope, middleware);
      }

      for (const route of declaration.routes) {
        for (const mount of addressesOf({ route, version: declaration.version })) {
          mountRoute({
            app,
            basePath,
            method: route.method,
            path: mount.path,
            stack: routeStack({
              route,
              family: declaration.namespace,
              ports,
              options,
              ...mount.context,
            }),
            policy: registryPolicy({ route, options }),
            credentialClass: CREDENTIAL_CLASS[options.credential],
            family: declaration.namespace,
          });
        }
      }

      mountVersionGuards({ app, basePath, declaration, ports, options });
      app.onError(options.onError);

      return app;
    },
  };
}

/** The three addresses one route answers at, and what each one reports. */
function addressesOf({
  route,
  version,
}: {
  route: RestTransportRoute<unknown>;
  version: string;
}): readonly {
  path: string;
  context: { version: string; status: VersionStatus; suffix?: string };
}[] {
  const path = route.path || "/";

  return [
    { path: `/${version}${path}`, context: { version, status: "stable", suffix: dated(version) } },
    {
      path: `/${VERSION_LATEST}${path}`,
      context: { version: VERSION_LATEST, status: "latest", suffix: VERSION_LATEST },
    },
    { path, context: { version: VERSION_LATEST, status: "latest" } },
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
  family,
  ports,
  options,
  version,
  status,
  suffix,
  paramSource = "route",
  documented = true,
}: {
  route: RestTransportRoute<Api>;
  family: string;
  ports: RestRuntimePorts;
  options: RestMountOptions<Api>;
  version: string;
  status: VersionStatus;
  suffix?: string | undefined;
  paramSource?: "route" | "context";
  documented?: boolean;
}): MiddlewareHandler[] {
  const stack: MiddlewareHandler[] = [
    versionContext({ route, family, version, status }),
    ...(documented ? [documentRoute({ route, suffix })] : []),
    ...validators({ route, documented, paramSource }),
    inputMiddleware({ route, paramSource }),
  ];

  if (route.bodyLimit) {
    const limit = route.bodyLimit;

    stack.push(
      bodyLimit({
        maxSize: limit.maxBytes,
        onError: () => {
          throw limit.onExceeded();
        },
      }),
    );
  }

  stack.push(handlerMiddleware({ route, ports, options }));

  return stack;
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
    const body = route.input ? context.req.valid("json" as never) : undefined;

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
  ports,
  options,
}: {
  route: RestTransportRoute<Api>;
  ports: RestRuntimePorts;
  options: RestMountOptions<Api>;
}): MiddlewareHandler {
  return async (context) => {
    const input = context.get(ROUTE_INPUT);

    const caller = await ports.identity.authenticate({
      request: context.req.raw,
      permission: route.permission,
    });

    const decision = await decide({
      declaration: {
        kind: "service-authorized",
        reason: options.reason ?? HOST_ENFORCED,
        permissions: [route.permission],
      },
      caller: { actor: normalizedActor(caller.actor), scope: caller.scope },
      input,
      ...(ports.authorization
        ? { authorize: ports.authorization.forRequest(context.req.raw) }
        : {}),
      ...(ports.denials ? { denials: ports.denials } : {}),
    });

    const result = await route.handler({
      app: options.app(),
      input,
      actor: decision.actor,
      scope: projectScopeOf(caller.scope),
      signal: context.req.raw.signal,
    });

    caller.markUsed?.();

    return respond({ context, route, result });
  };
}

function normalizedActor(actor: Actor | null): (Actor & { id: string }) | null {
  if (!actor) return null;

  const parsed = actorSchema.parse(actor);

  return "id" in parsed && typeof parsed.id === "string"
    ? (parsed as Actor & { id: string })
    : null;
}

function projectScopeOf(scope: AuthzDeclaredScopeId) {
  if (scope.tier !== "project") {
    throw new Error("REST transport authorization did not establish a project scope");
  }

  return scope;
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
}: {
  app: Hono;
  basePath: string;
  declaration: RestTransportDeclaration<Api>;
  ports: RestRuntimePorts;
  options: RestMountOptions<Api>;
}): void {
  const namespace = "/:apiVersion{latest|preview|20\\d{2}-\\d{2}-\\d{2}}";
  const fallback = dateFallback({ basePath, declaration, ports, options });
  const notFound: MiddlewareHandler = async (context) => context.notFound();

  for (const guard of [namespace, `${namespace}/*`]) {
    const handlers: [MiddlewareHandler, ...MiddlewareHandler[]] = [fallback, notFound];
    const absolute = mergePath(basePath, guard);
    const alias = canonicalV1Path(absolute);

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
}: {
  basePath: string;
  declaration: RestTransportDeclaration<Api>;
  ports: RestRuntimePorts;
  options: RestMountOptions<Api>;
}): MiddlewareHandler {
  const candidates = declaration.routes.map((route) => ({
    method: route.method,
    pattern: route.path || "/",
    stack: routeStack({
      route,
      family: declaration.namespace,
      ports,
      options,
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
    const method = context.req.method.toLowerCase();

    for (const candidate of candidates) {
      if (candidate.method !== method) continue;

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
  method,
  path,
  stack,
  policy,
  credentialClass,
  family,
}: {
  app: Hono;
  basePath: string;
  method: HttpMethod;
  path: string;
  stack: MiddlewareHandler[];
  policy: AccessPolicy;
  credentialClass: CredentialClass;
  family: string;
}): void {
  const absolute = mergePath(basePath, path);
  const alias = canonicalV1Path(absolute);

  register({ app, method, path: absolute, stack });
  if (alias) register({ app, method, path: alias, stack: undescribedStack(stack) });

  registerRoutePolicy({
    method,
    path: absolute,
    ...(alias ? { canonicalPath: alias } : {}),
    policy,
    family,
    credentialClass,
  });
}

function register({
  app,
  method,
  path,
  stack,
}: {
  app: Hono;
  method: HttpMethod;
  path: string;
  stack: MiddlewareHandler[];
}): void {
  const handlers = stack as [MiddlewareHandler, ...MiddlewareHandler[]];

  // Hono exposes no `.head` shortcut, and HEAD is answered from the GET route
  // before routing, so that registration is for the registry and the document.
  if (method === "head") app.on("HEAD", path, ...handlers);
  else app[method](path, ...handlers);
}

const HANDLER_CREDENTIAL = {
  projectKey: "apiKey",
  organizationKey: "apiKey",
  session: "session",
  internalSecret: "internal",
} as const satisfies Record<Exclude<Credential, "public">, HandlerCredential>;

/** Which security scheme a consumer of each credential presents. */
const CREDENTIAL_CLASS = {
  projectKey: "project_api_key",
  organizationKey: "organization_api_key",
  session: "session",
  internalSecret: "internal",
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
}: {
  route: RestTransportRoute<Api>;
  options: RestMountOptions<Api>;
}): AccessPolicy {
  const reason = options.reason ?? HOST_ENFORCED;

  if (options.credential === "public") return publicEndpoint(reason);

  return handlerManagedAuth({
    reason,
    credential: HANDLER_CREDENTIAL[options.credential],
    permissions: [route.permission],
  });
}
