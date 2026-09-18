/**
 * @vitest-environment node
 *
 * The hosted MCP feature, booted over its store members and peers alone.
 */
import { AuthzApi } from "@langwatch/authz-contract";
import { HostedMcpApi } from "@langwatch/hosted-mcp-contract";
import { createApp } from "@langwatch/kernel";
import { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import { describe, expect, it } from "vitest";

import { hostedMcpServer } from "../../hosted-mcp.server.ts";

function process() {
  return createApp({ role: "api" })
    .withModules([hostedMcpServer])
    .withMember("keyvalue", null)
    .withMember("encryption", {
      encrypt: (value: string) => value,
      decrypt: (value: string) => value,
    })
    .withMember("publicBaseUrl", "https://app.langwatch.ai")
    .provide({
      project: createApiFixture<ProjectApi>(),
      authz: createApiFixture<AuthzApi>(),
    });
}

describe("hosted MCP app installation", () => {
  /** @scenario "The hosted MCP feature installs from store members and peers alone" */
  it("installs a working app with no bespoke composition", async () => {
    const runtime = await process().boot();

    try {
      const app = runtime.service(HostedMcpApi);
      expect(runtime.module(hostedMcpServer).provided).toBe(app);

      const handler = app.createHandler();
      expect(handler.isMcpRoute("/mcp")).toBe(true);
      await handler.closeAllSessions();
    } finally {
      await runtime.stop();
    }
  });
});
