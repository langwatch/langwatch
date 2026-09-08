import type { AuthzDeclaredScopeId, AuthzPermission } from "@langwatch/authz-contract";
import type { FeatureApiToken } from "@langwatch/runtime-composition/contract";
import { z } from "zod";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { ApiHandlerArguments } from "../handler-arguments.ts";
import { assertVersionLabel, type DateVersion, type HttpMethod } from "./types.ts";
import type { RestTransportMiddleware } from "./transport-middleware.ts";

/** The portable part of a feature API token; no runtime-composition dependency. */
export type FeatureApiWitness<Api> = FeatureApiToken<Api>;

type SourceSchema = z.ZodObject | z.ZodDiscriminatedUnion<readonly z.ZodObject[]>;
type Missing = undefined;
type RouteSource = SourceSchema | Missing;
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
type RouteInput<Params extends RouteSource, Query extends RouteSource, Body extends RouteSource> = [
  Params,
  Query,
  Body,
] extends [Missing, Missing, Missing]
  ? undefined
  : SourceInput<Params> & SourceInput<Query> & SourceInput<Body>;
type OutputSchema = z.ZodObject | z.ZodArray | z.ZodVoid | z.ZodUndefined;
export type RestTransportDocs = Readonly<{
  readonly summary?: string;
  readonly description?: string;
}>;
type ProjectScope = Extract<AuthzDeclaredScopeId, { tier: "project" }>;
type ProjectScopedHandlerArguments<Input, App> = Omit<ApiHandlerArguments<Input, App>, "scope"> & {
  readonly scope: ProjectScope;
};
type StoredHandler<Api> = {
  invoke(args: ProjectScopedHandlerArguments<unknown, Api>, ...facts: unknown[]): unknown;
}["invoke"];
type MiddlewareFacts<Middleware extends readonly RestTransportMiddleware[]> = {
  [Index in keyof Middleware]: z.output<Middleware[Index]["schema"]>;
};
type RouteResult<Output extends OutputSchema | Missing> = Output extends OutputSchema
  ? z.input<Output> | Promise<z.input<Output>>
  : void | Promise<void>;

export type RestTransportRoute<Api> = Readonly<{
  readonly method: HttpMethod;
  readonly path: string;
  readonly operation: string;
  readonly version: DateVersion;
  readonly docs?: RestTransportDocs;
  readonly params?: z.ZodObject;
  readonly input?: SourceSchema;
  readonly permission: AuthzPermission;
  readonly permissionScope?: string;
  readonly query?: z.ZodObject;
  readonly output: OutputSchema;
  readonly status?: ContentfulStatusCode;
  readonly middleware?: readonly RestTransportMiddleware[];
  readonly bodyLimit?: Readonly<{ maxBytes: number; onExceeded(): Error }>;
  readonly handler: StoredHandler<Api>;
}>;

/** Inert REST transport metadata consumed by a process-owned mount adapter. */
export type RestTransportDeclaration<Api> = Readonly<{
  readonly protocol: "rest";
  readonly api: FeatureApiWitness<Api>;
  /** The family's own path segment: `/api/<namespace>`. */
  readonly namespace: string;
  readonly version: DateVersion;
  readonly routes: readonly RestTransportRoute<Api>[];
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
  Output extends OutputSchema | Missing = Missing,
  Permission extends boolean = false,
  Middleware extends readonly RestTransportMiddleware[] = [],
> {
  constructor(
    private readonly router: RestTransportRouter<Api>,
    private readonly method: Method,
    private readonly path: Path,
    private readonly operation: string,
    private readonly state: Readonly<{
      params?: z.ZodObject;
      input?: SourceSchema;
      query?: z.ZodObject;
      output?: OutputSchema;
      permission?: AuthzPermission;
      version?: DateVersion;
      docs?: RestTransportDocs;
      status?: ContentfulStatusCode;
      middleware?: readonly RestTransportMiddleware[];
      bodyLimit?: Readonly<{ maxBytes: number; onExceeded(): Error }>;
    }> = {},
  ) {}

  withParams<Schema extends z.ZodObject>(
    schema: ExactPathSchema<Path, Schema> &
      DistinctSchema<Schema, Body> &
      DistinctSchema<Schema, Query>,
  ): RouteBuilder<Api, Method, Path, Schema, Body, Query, Output, Permission, Middleware> {
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
      Middleware
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
    Middleware
  > {
    assertBodyMethod(this.method, this.path);
    assertSourceUnset("input", this.state.input);
    assertDistinctSources(this.state.params, schema);
    assertDistinctSources(this.state.query, schema);

    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      input: schema,
    });
  }

  withQuery<Schema extends z.ZodObject>(
    schema: Schema & DistinctSchema<Schema, Params> & DistinctSchema<Schema, Body>,
  ): RouteBuilder<Api, Method, Path, Params, Body, Schema, Output, Permission, Middleware> {
    assertSourceUnset("query", this.state.query);
    assertDistinctSources(this.state.params, schema);
    assertDistinctSources(this.state.input, schema);

    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      query: schema,
    });
  }

  withPermission(
    permission: AuthzPermission,
  ): RouteBuilder<Api, Method, Path, Params, Body, Query, Output, true, Middleware> {
    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      permission,
    });
  }

  withVersion(
    version: DateVersion,
  ): RouteBuilder<Api, Method, Path, Params, Body, Query, Output, Permission, Middleware> {
    assertVersionLabel(version);

    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      version,
    });
  }

  withDocs(
    docs: RestTransportDocs,
  ): RouteBuilder<Api, Method, Path, Params, Body, Query, Output, Permission, Middleware> {
    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      docs,
    });
  }

  withOutput<Schema extends OutputSchema>(
    schema: Schema,
  ): RouteBuilder<Api, Method, Path, Params, Body, Query, Schema, Permission, Middleware> {
    assertSourceUnset("output", this.state.output);

    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      output: schema,
    });
  }

  handle<TResult extends RouteResult<Output>>(
    this: RouteReady<Path, Params, Permission> extends true
      ? RouteBuilder<Api, Method, Path, Params, Body, Query, Output, Permission, Middleware>
      : never,
    handler: (
      args: ProjectScopedHandlerArguments<RouteInput<Params, Query, Body>, Api>,
      ...facts: MiddlewareFacts<Middleware>
    ) => TResult,
  ): RestTransportRouter<Api> {
    assertRouteReady({
      method: this.method,
      path: this.path,
      operation: this.operation,
      state: this.state,
    });

    this.router.assertRouteAvailable(this.method, this.path, this.operation);

    this.router.routes.push({
      method: this.method,
      path: this.path,
      operation: this.operation,
      version: this.state.version ?? this.router.version,
      ...(this.state.docs ? { docs: this.state.docs } : {}),
      ...(this.state.params ? { params: this.state.params } : {}),
      ...(this.state.input ? { input: this.state.input } : {}),
      ...(this.state.query ? { query: this.state.query } : {}),
      permission: permissionOf(this.state.permission),
      output: this.state.output ?? z.void(),
      ...(this.state.status === void 0 ? {} : { status: this.state.status }),
      ...(this.state.middleware ? { middleware: this.state.middleware } : {}),
      ...(this.state.bodyLimit ? { bodyLimit: this.state.bodyLimit } : {}),
      handler: handler as StoredHandler<Api>,
    });

    return this.router;
  }

  withStatus(
    status: ContentfulStatusCode,
  ): RouteBuilder<Api, Method, Path, Params, Body, Query, Output, Permission, Middleware> {
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
  ): RouteBuilder<Api, Method, Path, Params, Body, Query, Output, Permission, Middleware> {
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
    [...Middleware, ...Added]
  > {
    return new RouteBuilder(this.router, this.method, this.path, this.operation, {
      ...this.state,
      middleware: [...(this.state.middleware ?? []), ...middleware],
    });
  }
}

class RestTransportRouter<Api> {
  readonly routes: RestTransportRoute<Api>[] = [];

  constructor(
    private readonly api: FeatureApiWitness<Api>,
    readonly namespace: string,
    readonly version: DateVersion,
  ) {}

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
      routes: this.routes,
    };

    return { protocol: "rest", namespace: this.namespace, router: () => declaration };
  }

  get<Path extends string>(path: Path, operation: string): RouteBuilder<Api, "get", Path> {
    assertSupportedPath(path);

    return new RouteBuilder(this, "get", path, operation);
  }

  patch<Path extends string>(path: Path, operation: string): RouteBuilder<Api, "patch", Path> {
    assertSupportedPath(path);

    return new RouteBuilder(this, "patch", path, operation);
  }

  post<Path extends string>(path: Path, operation: string): RouteBuilder<Api, "post", Path> {
    assertSupportedPath(path);

    return new RouteBuilder(this, "post", path, operation);
  }

  put<Path extends string>(path: Path, operation: string): RouteBuilder<Api, "put", Path> {
    assertSupportedPath(path);

    return new RouteBuilder(this, "put", path, operation);
  }

  delete<Path extends string>(path: Path, operation: string): RouteBuilder<Api, "delete", Path> {
    assertSupportedPath(path);

    return new RouteBuilder(this, "delete", path, operation);
  }

  assertRouteAvailable(method: HttpMethod, path: string, operation: string): void {
    if (this.routes.some((route) => route.method === method && route.path === path)) {
      throw new Error(`REST ${method.toUpperCase()} ${path} is already registered`);
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
        withVersion(version: DateVersion): RestTransportRouter<Api> {
          assertVersionLabel(version);

          return new RestTransportRouter<Api>(api, namespace, version);
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

function assertSupportedPath(path: string): void {
  if (/:[A-Za-z0-9_]+[?+*]/.test(path)) {
    throw new Error(`REST path "${path}" uses unsupported optional or repeated parameters`);
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
  state: Readonly<{ params?: z.ZodObject; permission?: AuthzPermission; output?: OutputSchema }>;
}): void {
  if (!state.permission) throw new Error(`REST ${operation} must declare withPermission()`);

  if (/:([A-Za-z0-9_]+)/.test(path) && !state.params) {
    throw new Error(`REST ${method.toUpperCase()} ${path} must declare withParams()`);
  }
}

function permissionOf(permission: AuthzPermission | undefined): AuthzPermission {
  if (!permission) throw new Error("REST route must declare withPermission()");

  return permission;
}
