import { lookup as dnsLookup } from "node:dns";
import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import { isIP, type LookupFunction } from "node:net";

import { NodeHttpHandler, type NodeHttpHandlerOptions } from "@smithy/node-http-handler";

const PINNED_CONNECTION_TIMEOUT_MS = 5_000;
const PINNED_REQUEST_TIMEOUT_MS = 20_000;

/** A host an egress fence judged, with the address it resolved; an `SsrfValidationResult` fits. */
export type JudgedEndpoint = { hostname: string; resolvedIp?: string };

/** A DNS lookup that answers every name with the one address the egress fence judged. */
export function pinnedLookup(ip: string): LookupFunction {
  const family = isIP(ip) === 6 ? 6 : 4;
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [{ address: ip, family }]);
    else callback(null, ip, family);
  };
}

/** The address the egress fence judged for one host; a host it could not resolve is refused. */
function judgedAddressOf(validated: JudgedEndpoint): string {
  const ip = validated.resolvedIp;
  if (!ip || isIP(ip) === 0) {
    throw new Error(`endpoint ${validated.hostname} did not resolve to an address to pin`);
  }
  return ip;
}

/** A DNS lookup that answers each judged host with its address and resolves any other name. */
export function pinnedHostsLookup(addresses: ReadonlyMap<string, string>): LookupFunction {
  return (hostname, options, callback) => {
    const ip = addresses.get(hostname.toLowerCase());
    if (ip === undefined) return dnsLookup(hostname, options, callback);
    return pinnedLookup(ip)(hostname, options, callback);
  };
}

/** The shared AWS client's deadlines, enforced: a stalled custom endpoint fails, never hangs. */
export function pinnedHandlerOptions(lookup: LookupFunction): NodeHttpHandlerOptions {
  return {
    httpAgent: new HttpAgent({ lookup }),
    httpsAgent: new HttpsAgent({ lookup }),
    connectionTimeout: PINNED_CONNECTION_TIMEOUT_MS,
    requestTimeout: PINNED_REQUEST_TIMEOUT_MS,
    throwOnRequestTimeout: true,
  };
}

function handlerFor(lookup: LookupFunction): { requestHandler: NodeHttpHandler } {
  return { requestHandler: new NodeHttpHandler(pinnedHandlerOptions(lookup)) };
}

/**
 * A request handler for a customer-supplied endpoint that dials only the judged address, so a
 * name that resolves elsewhere at connect time (DNS rebinding) cannot reach a refused host. The
 * Host header and the TLS servername keep the original name.
 */
export function pinnedEndpointConfig(validated: JudgedEndpoint): {
  requestHandler: NodeHttpHandler;
} {
  return handlerFor(pinnedLookup(judgedAddressOf(validated)));
}

/** Pins every judged host to its own address; names the fence did not judge resolve normally. */
export function pinnedHostsConfig(validated: readonly JudgedEndpoint[]): {
  requestHandler?: NodeHttpHandler;
} {
  if (validated.length === 0) return {};
  const addresses = new Map(
    validated.map((result) => [result.hostname.toLowerCase(), judgedAddressOf(result)] as const),
  );
  return handlerFor(pinnedHostsLookup(addresses));
}
