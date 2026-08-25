import { toJsonSchema } from "@standard-community/standard-json";
import type { ApiSchema } from "./schema.js";

import { isNoBodySchema } from "./definition.js";
import { isRpcPath } from "./rpc-name.js";
import type { EndpointDef } from "./types.js";
import type { ResolvedEndpoint } from "./versioning.js";

// ---------------------------------------------------------------------------
// rpc.discover: the service's own RPC catalogue (specs/api-discovery.feature)
//
// Every service serves its own catalogue at
// `/api/{service}/{version}/rpc.discover`, mounted by `build()` under every
// version namespace. It is a PROJECTION of the service's resolved
// registrations — the same source OpenAPI generation reads — so it cannot
// report an operation that does not exist, omit one that is documented, or
// disagree about a schema. Nothing registers with it; it holds no state.
//
// The documented-only rule is the document's own: an operation reaches the
// catalogue exactly when its registration would reach the OpenAPI document
// (an output or docs declared, and not hidden), and preview endpoints never
// reach either. A discover endpoint is itself meta: it is never documented,
// and no catalogue ever lists another catalogue.
// ---------------------------------------------------------------------------

/** The operation name every service's catalogue is served under. */
export const DISCOVER_NAME = "rpc.discover";

/** One RPC operation, as a catalogue reports it. */
export interface DiscoveredOperation {
  /** The dotted operation name, e.g. `things.create`. */
  name: string;
  /** The absolute path to POST to, in this catalogue's namespace. */
  path: string;
  /** The operation id from `withDocs`, which is also the SDK's function name. */
  operationId?: string;
  summary?: string;
  description?: string;
  /** JSON Schema for the request body, or `null` when it takes no arguments. */
  input: unknown;
  /** JSON Schema for the success response body, or `null` when it sends none. */
  output: unknown;
  /** The success status this operation always answers. */
  status: number;
}

/** A service's own RPC catalogue. */
export interface ServiceCatalogue {
  /**
   * Where the complete description lives, when the service was configured
   * with `openapiUrl`. The catalogue covers RPC-named operations only; a
   * caller that wants the whole surface follows this.
   */
  openapi?: string;
  operations: DiscoveredOperation[];
}

/**
 * Whether a registration would reach the OpenAPI document from a dated or
 * `latest` mount: something documentable declared (`withOutput` or
 * `withDocs`) and not hidden. The catalogue lists exactly these, so it can
 * never describe an operation the document does not carry.
 */
function isDocumented(config: EndpointDef): boolean {
  if (config.docs?.hide === true) return false;
  return Boolean(config.output || config.docs);
}

/**
 * The JSON Schema for a zod schema.
 *
 * Awaited because it has to be: standard-json lazy-loads the vendor converter
 * through a dynamic import, so no synchronous path exists on first use. The
 * catalogue memoizes the result — see `mountDiscover` — so the cost is paid
 * once per process, not per request.
 */
async function jsonSchemaOf(schema: ApiSchema | undefined): Promise<unknown> {
  if (!schema) return null;
  return toJsonSchema(schema as never);
}

/**
 * Builds the catalogue one namespace serves, from the namespace's resolved
 * endpoints. Async because the schema conversion is (see `jsonSchemaOf`);
 * the caller memoizes the result, since the registrations it is derived from
 * cannot change while the process runs.
 *
 * `documentable` is false for the preview namespace: preview endpoints are
 * never documented, so a preview catalogue lists nothing — it still answers,
 * and still points at the document.
 */
export async function buildServiceCatalogue({
  basePath,
  namespace,
  endpoints,
  openapiUrl,
  documentable,
}: {
  basePath: string;
  namespace: string;
  endpoints: ResolvedEndpoint[];
  openapiUrl?: string;
  documentable: boolean;
}): Promise<ServiceCatalogue> {
  const operations: DiscoveredOperation[] = [];

  if (documentable) {
    for (const ep of endpoints) {
      if (ep.withdrawn) continue;
      // An RPC is a POST at a dotted name; the grammar is the whole test,
      // the same one registration and the root catalogue ask.
      if (ep.method !== "post") continue;
      const name = ep.path.slice(1);
      if (!isRpcPath(name)) continue;
      if (!isDocumented(ep.config)) continue;

      const docs = ep.config.docs;
      operations.push({
        name,
        path: `${basePath}/${namespace}${ep.path}`,
        ...(docs?.operationId !== undefined ? { operationId: docs.operationId } : {}),
        ...(docs?.summary !== undefined ? { summary: docs.summary } : {}),
        ...(docs?.description !== undefined ? { description: docs.description } : {}),
        input: await jsonSchemaOf(ep.config.input),
        output: await jsonSchemaOf(ep.config.output),
        status:
          ep.config.status ??
          (ep.config.output && isNoBodySchema(ep.config.output) ? 204 : 200),
      });
    }
  }

  // Sorted so the response is stable between requests: the catalogue is
  // derived, and the resolved array's order is the registration order.
  operations.sort((a, b) => a.path.localeCompare(b.path));

  return {
    ...(openapiUrl !== undefined ? { openapi: openapiUrl } : {}),
    operations,
  };
}
