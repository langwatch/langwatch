import type { IncomingMessage } from "node:http";
import { McpClientAddressPort } from "../ports/hosted-mcp.port";

/**
 * The address the endpoint rate-limits a caller by, read from the forwarding
 * headers in priority order.
 *
 * `cf-connecting-ip` first, because it is the header the edge writes itself:
 * Cloudflare replaces any caller-supplied value before the request reaches an
 * origin, so what is bucketed on is edge-authored rather than caller-authored
 * wherever the deployment keeps that edge in front. A deployment that exposes
 * the origin directly is trusting these headers to the same degree as every
 * other rate limit in front of it.
 *
 * The order is here rather than in a composition root because it is the rate
 * limit's own correctness: a bucket keyed on the wrong header charges one
 * caller for another's traffic, which is what the suite beside this asserts
 * does not happen.
 *
 * `unknown` for a request with no address at all, rather than a throw — a rate
 * limiter that failed open on an unidentifiable caller would be no limiter.
 */
export class HeaderMcpClientAddressAdapter extends McpClientAddressPort {
  private static readonly HEADERS = [
    "cf-connecting-ip",
    "true-client-ip",
    "x-real-ip",
    "x-forwarded-for",
  ] as const;

  static create(): HeaderMcpClientAddressAdapter {
    return new HeaderMcpClientAddressAdapter();
  }

  clientIp(request: IncomingMessage): string {
    for (const header of HeaderMcpClientAddressAdapter.HEADERS) {
      const value = request.headers[header];
      const raw = Array.isArray(value) ? value[0] : value;
      // `x-forwarded-for` is a list; the client is its first entry, and every
      // entry after it was appended by a proxy on the way in.
      const first = raw?.split(",")[0]?.trim();
      if (first) return first;
    }
    return request.socket.remoteAddress ?? "unknown";
  }
}
