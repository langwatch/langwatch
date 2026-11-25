import type { IncomingMessage } from "node:http";

import { ClientAddress } from "@langwatch/api/policy";

/**
 * The address the process resolved for this raw request (ClientAddress), else its socket peer.
 * No forwarding header is read here. 'unknown' when neither exists, so the limiter fails safe.
 */
export class ResolvedMcpClientAddressService {
  private constructor() {}

  static create(): ResolvedMcpClientAddressService {
    return new ResolvedMcpClientAddressService();
  }

  clientIp(request: IncomingMessage): string {
    return ClientAddress.resolvedFor(request) ?? request.socket.remoteAddress ?? "unknown";
  }
}
