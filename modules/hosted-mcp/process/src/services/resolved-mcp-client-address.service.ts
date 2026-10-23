import type { McpDoorRequest } from "@langwatch/hosted-mcp-contract";

/** What a caller's address is read from: the address the door resolved for the request. */
export type McpClientAddressSource = Pick<McpDoorRequest, "clientAddress">;

/**
 * The address the process resolved for this request (ClientAddress), else its socket peer.
 * No forwarding header is read here. 'unknown' when neither exists, so the limiter fails safe.
 */
export class ResolvedMcpClientAddressService {
  private constructor() {}

  static create(): ResolvedMcpClientAddressService {
    return new ResolvedMcpClientAddressService();
  }

  clientIp(request: McpClientAddressSource): string {
    return request.clientAddress ?? "unknown";
  }
}
