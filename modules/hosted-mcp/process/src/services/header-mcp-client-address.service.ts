import type { IncomingMessage } from "node:http";

import { McpClientAddress } from "../app/hosted-mcp-members.ts";

/**
 * Reads forwarding headers in priority order (cf-connecting-ip first as edge-authored).
 * Returns 'unknown' if no address found, so rate limiter fails safe.
 */
export class HeaderMcpClientAddressService extends McpClientAddress {
  private static readonly HEADERS = [
    "cf-connecting-ip",
    "true-client-ip",
    "x-real-ip",
    "x-forwarded-for",
  ] as const;

  private constructor() {
    super();
  }

  static create(): HeaderMcpClientAddressService {
    return new HeaderMcpClientAddressService();
  }

  clientIp(request: IncomingMessage): string {
    for (const header of HeaderMcpClientAddressService.HEADERS) {
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
