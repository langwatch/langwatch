/**
 * The RPC catalogue: every dotted `<resource>.<verb>` operation the API
 * publishes, with the schemas for its arguments and its result.
 *
 * This is a PROJECTION of the OpenAPI document, computed on demand. It is not a
 * registry, nothing writes to it, and no family registers with it. That is the
 * whole design: an operation appears here because it appears in the published
 * document, so the catalogue cannot describe an endpoint that does not exist,
 * omit one that does, or disagree with the document about its schema. There is
 * one source of truth and this reads it.
 *
 * Two consequences worth stating, because both look like bugs and are not:
 *
 *   - An operation the document does not carry is absent here. `v.rpc` mounts a
 *     real POST, so the generator documents it like any other endpoint — but an
 *     endpoint that opts out with `docs: { hide: true }`, or that declares no
 *     `output`/`description`/`docs` at all, never reaches the document and so
 *     never reaches this. That is the same rule every other reader of the
 *     document already lives under, not a second one.
 *   - The catalogue is empty until a family adopts RPC naming. It is empty
 *     today. Nothing needs backfilling when one does.
 *
 * Recognising a dotted name is `isRpcPath` from `@langwatch/api` — the same
 * grammar `v.rpc` refuses a registration with, rather than a second regex here
 * that agrees with it until someone changes one of them.
 *
 * See specs/api-reference/api-discovery.feature.
 */

import { isRpcPath } from "@langwatch/api";

/** One RPC operation, as the catalogue reports it. */
export interface RpcOperation {
  /** The dotted operation name, e.g. `endpoints.rollSecret`. */
  name: string;
  /** The absolute path to POST to. */
  path: string;
  /** The document's operation id, which is also the SDK's function name. */
  operationId?: string;
  summary?: string;
  description?: string;
  /**
   * JSON Schema for the request body, or `null` for an operation that takes no
   * arguments. `$ref`s resolve against `components` below.
   */
  input: unknown;
  /** JSON Schema for the success response body, or `null` when it sends none. */
  output: unknown;
  /** The success status this operation always answers. */
  status: number;
}

export interface RpcCatalogue {
  /**
   * Where the complete description lives. The catalogue covers RPC-named
   * operations only; a caller that wants the whole surface follows this.
   */
  openapi: string;
  operations: RpcOperation[];
  /** The document's shared schemas, so a `$ref` in an operation resolves. */
  components: unknown;
}

type JsonObject = Record<string, unknown>;

const asObject = (value: unknown): JsonObject | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;

/** The dotted name is the last path segment; `/api/webhooks/endpoints.create`. */
function rpcNameFor(path: string): string | undefined {
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash === -1) return undefined;

  const segment = path.slice(lastSlash);
  return isRpcPath(segment) ? segment.slice(1) : undefined;
}

/** The `application/json` schema out of an OpenAPI request body or response. */
function jsonSchemaOf(carrier: unknown): unknown {
  const content = asObject(asObject(carrier)?.content);
  const json = asObject(content?.["application/json"]);
  return json?.schema ?? null;
}

/**
 * The success response, and the status it answers. `v.rpc` endpoints answer
 * exactly one success status — `assertStatusInvariant` in `@langwatch/api`
 * refuses a registration where it could move — so taking the first 2xx is
 * reading a decision the framework already made, not guessing between several.
 */
function successResponse(operation: JsonObject): {
  status: number;
  schema: unknown;
} {
  const responses = asObject(operation.responses) ?? {};
  for (const [code, response] of Object.entries(responses)) {
    const status = Number(code);
    if (!Number.isInteger(status) || status < 200 || status > 299) continue;
    return { status, schema: jsonSchemaOf(response) };
  }
  return { status: 200, schema: null };
}

/**
 * The prose the document carries about an operation, copied only where it is
 * actually a string. Omitted rather than set to undefined, so the catalogue's
 * JSON has no null-valued keys a client has to reason about.
 */
function describedFields(operation: JsonObject): {
  operationId?: string;
  summary?: string;
  description?: string;
} {
  const fields: {
    operationId?: string;
    summary?: string;
    description?: string;
  } = {};
  for (const key of ["operationId", "summary", "description"] as const) {
    const value = operation[key];
    if (typeof value === "string") fields[key] = value;
  }
  return fields;
}

/** One path's RPC operation, or null when the path is not an RPC at all. */
function rpcOperationFor({
  path,
  methods,
}: {
  path: string;
  methods: unknown;
}): RpcOperation | null {
  const name = rpcNameFor(path);
  if (!name) return null;

  // An RPC is always a POST. Anything else on a dotted path is not one, and
  // reporting it as one would advertise a call that does not work.
  const operation = asObject(asObject(methods)?.post);
  if (!operation) return null;

  const { status, schema } = successResponse(operation);
  return {
    name,
    path,
    ...describedFields(operation),
    input: jsonSchemaOf(operation.requestBody),
    output: schema,
    status,
  };
}

/** Projects the RPC-named operations out of an OpenAPI document. */
export function buildRpcCatalogue({
  document,
  openapiUrl,
}: {
  document: Record<string, unknown>;
  openapiUrl: string;
}): RpcCatalogue {
  const paths = asObject(document.paths) ?? {};
  const operations = Object.entries(paths)
    .map(([path, methods]) => rpcOperationFor({ path, methods }))
    .filter((operation): operation is RpcOperation => operation !== null)
    // Sorted so the response is stable between requests: the catalogue is
    // derived per call, and Object.entries order is the document's, not ours.
    .sort((a, b) => a.path.localeCompare(b.path));

  return {
    openapi: openapiUrl,
    operations,
    components: asObject(document.components)?.schemas ?? {},
  };
}
