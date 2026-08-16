import type { ZodType } from "zod";
import type { SSEConfig, SSEHandler } from "./sse.js";
import {
  type EndpointConfig,
  type EndpointRegistration,
  type Handler,
  type HttpMethod,
  VERSION_LATEST,
  VERSION_PREVIEW,
} from "./types.js";

const DATE_VERSION_SEGMENT_RE = /^20\d{2}-\d{2}-\d{2}$/;

/**
 * Builder used inside the `.version(date, (v) => { ... })` callback.
 *
 * Provides HTTP method helpers and `withdraw()` for removing inherited
 * endpoints.
 */
export class VersionBuilder<TApp> {
  /** @internal */
  readonly _endpoints: EndpointRegistration[] = [];

  /** Register a GET endpoint. */
  get<TConfig extends EndpointConfig>(
    path: string,
    config: TConfig,
    handler: Handler<TApp, TConfig>,
  ): void {
    this._register("get", path, config, handler);
  }

  /** Register a POST endpoint. */
  post<TConfig extends EndpointConfig>(
    path: string,
    config: TConfig,
    handler: Handler<TApp, TConfig>,
  ): void {
    this._register("post", path, config, handler);
  }

  /** Register a PUT endpoint. */
  put<TConfig extends EndpointConfig>(
    path: string,
    config: TConfig,
    handler: Handler<TApp, TConfig>,
  ): void {
    this._register("put", path, config, handler);
  }

  /** Register a DELETE endpoint. */
  delete<TConfig extends EndpointConfig>(
    path: string,
    config: TConfig,
    handler: Handler<TApp, TConfig>,
  ): void {
    this._register("delete", path, config, handler);
  }

  /** Register a PATCH endpoint. */
  patch<TConfig extends EndpointConfig>(
    path: string,
    config: TConfig,
    handler: Handler<TApp, TConfig>,
  ): void {
    this._register("patch", path, config, handler);
  }

  /** Register a typed GET-only SSE endpoint. */
  sse<
    TEvents extends Record<string, ZodType>,
    TConfig extends SSEConfig<TEvents>,
  >(
    path: string,
    config: TConfig,
    handler: SSEHandler<TApp, TEvents, TConfig>,
  ): void {
    assertEndpointPath(path);
    this._endpoints.push({
      method: "sse",
      path,
      config: config as unknown as EndpointConfig,
      handler: handler as EndpointRegistration["handler"],
    });
  }

  /**
   * Register an RPC-named endpoint (ADR-094). Mounts as a real POST; the
   * dotted name carries the verb, so the method never does.
   *
   * Every argument travels in the JSON body — there are no path params and no
   * query string. An RPC with no required arguments declares no `input` and
   * ignores the body: the pipeline only installs the json validator when
   * `input` is present, so a bodyless POST and a `{}` POST both succeed.
   * Declaring `input: z.object({}).optional()` instead would reinstate the
   * parse and reject the bodyless call.
   */
  rpc<TConfig extends EndpointConfig>(
    path: string,
    config: TConfig,
    handler: Handler<TApp, TConfig>,
  ): void {
    assertRpcPath(path);
    assertRpcConfig(path, config);
    this._register("post", path, config, handler);
  }

  /** Withdraw an endpoint inherited from a previous version. */
  withdraw(method: HttpMethod, path: string): void {
    assertEndpointPath(path);
    this._endpoints.push({
      method,
      path,
      config: {} as EndpointConfig,
      // biome-ignore lint/suspicious/noEmptyBlockStatements: a withdrawn endpoint's handler is never invoked; the shape exists to satisfy the record type.
      handler: () => {},
      withdrawn: true,
    });
  }

  private _register<TConfig extends EndpointConfig>(
    method: HttpMethod,
    path: string,
    config: TConfig,
    handler: Handler<TApp, TConfig>,
  ): void {
    assertEndpointPath(path);
    assertStatusInvariant(method, path, config);
    this._endpoints.push({
      method,
      path,
      config,
      handler: handler as EndpointRegistration["handler"],
    });
  }
}

/**
 * `<resource>.<verb>`, lower camelCase on both sides, at least one dot, no path
 * parameters. Pinning the grammar here rather than in review is the point: a
 * convention that lives only in a document drifts.
 *
 * `assertEndpointPath` still runs via `_register`, but it would pass a dotted
 * name on its own — `endpoints.create` is not `latest`, not `preview`, and not
 * date-shaped, so the reserved-namespace check has nothing to say about it.
 */
const RPC_PATH_RE = /^\/[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;

function assertRpcPath(path: string): void {
  if (!RPC_PATH_RE.test(path)) {
    throw new Error(
      `RPC endpoint path "${path}" must be a dotted <resource>.<verb> name in ` +
        `lower camelCase with no path parameters, e.g. "/endpoints.rollSecret"`,
    );
  }
}

/**
 * The pipeline installs a validator for whichever of `params` / `query` a
 * config declares, so "every argument travels in the body" holds only while
 * nothing declares them. Rejecting here makes the sentence above enforceable
 * rather than aspirational: a dotted path has no `:param` to bind, so a
 * `params` schema could never match, and a `query` schema would smuggle
 * arguments back into the URL that the operation name is supposed to own.
 */
function assertRpcConfig(path: string, config: EndpointConfig): void {
  const offending = (["params", "query"] as const).filter(
    (key) => config[key] !== undefined,
  );

  if (offending.length > 0) {
    throw new Error(
      `RPC endpoint "${path}" declares ${offending.join(" and ")}; RPC ` +
        `arguments travel in the JSON body, so use "input" instead`,
    );
  }
}

/**
 * An endpoint answers ONE success status, fixed here rather than per request.
 *
 * `serializeEndpointResult` used to read the handler's return value to choose:
 * a declared `output` that parsed `undefined` answered 204 while a value
 * answered 200, so one operation could return either depending on what it
 * found — and callers, the published document and the SDKs all have to pick
 * one. An `output` schema that accepts `undefined` is what makes that
 * reachable, so it is refused at registration.
 *
 * The two honest shapes remain: declare a required `output` and always answer
 * `status ?? 200`, or declare no `output` and always answer `status ?? 204`.
 */
function assertStatusInvariant(
  method: HttpMethod,
  path: string,
  config: EndpointConfig,
): void {
  // No schema, or one whose only accepted value is `undefined`: the endpoint
  // has no body and always answers `status ?? 204`.
  if (!config.output || isNoBodySchema(config.output)) return;
  // A schema that rejects `undefined`: the body is always present and the
  // endpoint always answers `status ?? 200`.
  if (!config.output.safeParse(undefined).success) return;

  // What is left accepts `undefined` AND a value — `.optional()`, `z.any()`,
  // a union with `undefined` in it — which is the only way the status can move.
  throw new Error(
    `Endpoint ${method.toUpperCase()} ${path} declares an "output" schema that ` +
      `accepts undefined as well as a value, so its success status would ` +
      `depend on what the handler returned — 204 when undefined, ` +
      `${config.status ?? 200} otherwise. Make the output required, or declare ` +
      `z.void() for an endpoint that never sends a body`,
  );
}

/**
 * True for the schemas whose ONLY accepted value is `undefined`, which declare
 * an endpoint that never sends a body.
 *
 * Read off zod's internal `typeName` deliberately: probing with sample values
 * cannot tell `z.undefined()` from `z.object({ id: z.string() }).optional()`,
 * since both reject every probe a caller could think to try — `{}` included.
 * `status-invariant.unit.test.ts` pins this against the pinned zod, so an
 * upgrade that renames the tag fails there rather than silently reclassifying
 * every no-body endpoint as ambiguous.
 */
function isNoBodySchema(output: ZodType): boolean {
  const typeName = (output._def as { typeName?: string } | undefined)?.typeName;
  return typeName === "ZodUndefined" || typeName === "ZodVoid";
}

function assertEndpointPath(path: string): void {
  if (path !== "" && !path.startsWith("/")) {
    throw new Error(`Endpoint path must start with "/"; received "${path}"`);
  }

  const firstSegment = path.split("/").find(Boolean);
  if (
    firstSegment === VERSION_LATEST ||
    firstSegment === VERSION_PREVIEW ||
    (firstSegment !== undefined && DATE_VERSION_SEGMENT_RE.test(firstSegment))
  ) {
    throw new Error(
      `Endpoint path "${path}" collides with the reserved API version namespace`,
    );
  }
}
