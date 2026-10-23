import { IncomingMessage } from "node:http";
import { Socket } from "node:net";

/**
 * Which caller the hosted MCP doors count: the address the process resolved, never a header.
 * @see specs/security/trusted-client-address.feature
 */
import { ClientAddress } from "@langwatch/api/policy";
import { describe, expect, it } from "vitest";

import { ResolvedMcpClientAddressService } from "../../services/resolved-mcp-client-address.service.ts";
import { mcpDoorRequest } from "../mcp-endpoint.rest.ts";

const SOCKET_PEER = "198.51.100.4";

/** A raw request from `SOCKET_PEER` that claims another caller in every vendor header. */
function forgedRequest({ socketAddress }: { socketAddress?: string } = {}): IncomingMessage {
  const socket = new Socket();
  Object.defineProperty(socket, "remoteAddress", { value: socketAddress });
  const request = new IncomingMessage(socket);
  request.headers = {
    "cf-connecting-ip": "203.0.113.66",
    "true-client-ip": "203.0.113.67",
    "x-real-ip": "203.0.113.68",
    "x-forwarded-for": "203.0.113.69, 203.0.113.70",
  };

  return request;
}

describe("the hosted MCP door's caller address", () => {
  const address = ResolvedMcpClientAddressService.create();

  describe("when the process stamped a request carrying forged forwarding headers", () => {
    /** @scenario "Hosted MCP ignores a forged CF-Connecting-IP" */
    it("keys the caller on the resolved address, not the forged CF-Connecting-IP", () => {
      const request = forgedRequest({ socketAddress: SOCKET_PEER });
      ClientAddress.fromTrustedProxies({ addresses: [] }).handleIncoming(request);

      expect(address.clientIp(mcpDoorRequest(request))).toBe(SOCKET_PEER);
    });
  });

  describe("when a trusted edge stamped the caller it names", () => {
    it("keys the caller on the address the edge resolved", () => {
      const request = forgedRequest({ socketAddress: SOCKET_PEER });
      ClientAddress.fromTrustedProxies({ addresses: [SOCKET_PEER] }).handleIncoming(request);

      expect(address.clientIp(mcpDoorRequest(request))).toBe("203.0.113.70");
    });
  });

  describe("when nothing stamped the request", () => {
    it("falls back to the socket peer and never reads a header", () => {
      expect(address.clientIp(mcpDoorRequest(forgedRequest({ socketAddress: SOCKET_PEER })))).toBe(
        SOCKET_PEER,
      );
    });

    it("answers unknown with no socket peer either, so the limiter still counts it", () => {
      expect(address.clientIp(mcpDoorRequest(forgedRequest()))).toBe("unknown");
    });
  });
});
