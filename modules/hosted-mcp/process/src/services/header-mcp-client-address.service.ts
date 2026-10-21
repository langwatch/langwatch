import type { McpDoorRequest } from "@langwatch/hosted-mcp-contract";

/** What an address is read from: the forwarding headers, then the socket's peer. */
export type McpClientAddressSource = Pick<McpDoorRequest, "headers" | "remoteAddress">;

/**
 * Reads forwarding headers in priority order (cf-connecting-ip first as edge-authored).
 * Returns 'unknown' if no address found, so rate limiter fails safe.
 */
export class HeaderMcpClientAddressService {
  private static readonly HEADERS = [
    "cf-connecting-ip",
    "true-client-ip",
    "x-real-ip",
    "x-forwarded-for",
  ] as const;

  private constructor() {}

  static create(): HeaderMcpClientAddressService {
    return new HeaderMcpClientAddressService();
  }

  clientIp(request: McpClientAddressSource): string {
    for (const header of HeaderMcpClientAddressService.HEADERS) {
      const value = request.headers[header];
      const raw = typeof value === "string" ? value : value?.[0];
      // `x-forwarded-for` is a list; the client is its first entry, and every
      // entry after it was appended by a proxy on the way in.
      const first = raw?.split(",")[0]?.trim();
      if (first) return first;
    }
    return request.remoteAddress ?? "unknown";
  }
}
