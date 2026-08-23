/**
 * The client side of the two-level rpc.discover contract
 * (packages/api/specs/api-discovery.feature): the root index names every
 * service's catalogue URL, and each service catalogue carries that service's
 * RPC operations with their JSON Schemas.
 *
 * Both levels are public by design — a caller reads the description to learn
 * how to authenticate — so these fetches deliberately send no credential.
 */

import { getConfig } from "./config.js";

/** One service, as the root index reports it. */
export interface RpcServiceEntry {
  name: string;
  discover: string;
}

export interface RpcServiceIndex {
  openapi: string;
  services: RpcServiceEntry[];
}

/** One RPC operation, as a service catalogue reports it. */
export interface DiscoveredOperation {
  name: string;
  path: string;
  operationId?: string;
  summary?: string;
  description?: string;
  /** JSON Schema for the request body, or `null` when it takes no arguments. */
  input: unknown;
  /** JSON Schema for the success response body, or `null` when it sends none. */
  output: unknown;
  status: number;
}

export interface ServiceCatalogue {
  openapi?: string;
  operations: DiscoveredOperation[];
}

/** How long one catalogue fetch may hang before discovery is abandoned. */
const DISCOVERY_TIMEOUT_MS = 15_000;

/**
 * POSTs an rpc.discover URL and parses the body. Any failure — network,
 * non-200, unparseable — is thrown with the URL named: the caller fails the
 * startup on it, because a silently empty tool list is undiscoverable from
 * the client side.
 */
async function postDiscover<T>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(
      `rpc.discover fetch failed for ${url}: ${error instanceof Error ? error.message : error}`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `rpc.discover fetch failed for ${url}: HTTP ${response.status}`,
    );
  }
  return (await response.json()) as T;
}

/** The root index: every API service and the URL of its own catalogue. */
export async function fetchServiceIndex(): Promise<RpcServiceIndex> {
  return postDiscover<RpcServiceIndex>(`${getConfig().endpoint}/api/rpc.discover`);
}

/** One service's catalogue of RPC operations. */
export async function fetchServiceCatalogue(
  discoverPath: string,
): Promise<ServiceCatalogue> {
  return postDiscover<ServiceCatalogue>(`${getConfig().endpoint}${discoverPath}`);
}
