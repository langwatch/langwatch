/**
 * @vitest-environment node
 * @see modules/hosted-mcp/specs/hosted-mcp.feature
 */
import { describe, expect, it } from "vitest";

import { HeaderMcpClientAddressService } from "../header-mcp-client-address.service.ts";

describe("HeaderMcpClientAddressService", () => {
  const address = HeaderMcpClientAddressService.create();

  describe("when forwarding headers and a socket peer are both present", () => {
    /** @scenario "The client address is read from forwarding headers before the socket" */
    it("takes the edge-authored header, then a forwarded list's first entry, then the socket", () => {
      const both = {
        headers: { "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" },
        remoteAddress: "9.9.9.9",
      };
      const listed = {
        headers: { "x-forwarded-for": "3.3.3.3, 10.0.0.1" },
        remoteAddress: "9.9.9.9",
      };
      const bare = { headers: {}, remoteAddress: "9.9.9.9" };
      const nothing = { headers: {}, remoteAddress: undefined };

      expect([both, listed, bare, nothing].map((request) => address.clientIp(request))).toEqual([
        "1.1.1.1",
        "3.3.3.3",
        "9.9.9.9",
        "unknown",
      ]);
    });
  });
});
