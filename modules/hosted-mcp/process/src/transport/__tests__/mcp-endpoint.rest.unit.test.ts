import { RawHttpHost } from "@langwatch/api";
import { createApiFixture } from "@langwatch/api-fixture";
import type { HostedMcpApiContract, HostedMcpHandler } from "@langwatch/hosted-mcp-contract";
import { describe, expect, it } from "vitest";

import { mcpEndpointDoor } from "../mcp-endpoint.rest.ts";

function recordingEndpoint(): HostedMcpHandler & { closed: number } {
  return {
    closed: 0,
    handleRequest: () => {
      throw new Error("the shutdown test sends no request");
    },
    isMcpRoute: () => true,
    clearTokenCache: () => undefined,
    clearRateLimiters: () => undefined,
    async closeAllSessions() {
      this.closed += 1;
    },
  };
}

describe("the hosted MCP door", () => {
  describe("when the api process shuts down", () => {
    /** @scenario "Shutdown closes every hosted MCP session" */
    it("closes the sessions of the one endpoint it opened at mount", async () => {
      const endpoint = recordingEndpoint();
      let opened = 0;
      const app = createApiFixture<HostedMcpApiContract>({
        createHandler: () => {
          opened += 1;
          return endpoint;
        },
      });
      const doors = RawHttpHost.create();
      doors.mount(mcpEndpointDoor.router(), () => app);

      await doors.close();

      expect({ opened, closed: endpoint.closed }).toEqual({ opened: 1, closed: 1 });
    });
  });
});
