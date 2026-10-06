import { createServer, type Server } from "node:http";

import { RawHttpHost } from "@langwatch/api";
/**
 * @vitest-environment node
 *
 * The hosted MCP feature, booted over its store members and peers alone.
 */
import type { AuthApi } from "@langwatch/auth-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { GovernanceRestApi } from "@langwatch/enterprise-governance-contract";
import { HostedMcpApi } from "@langwatch/hosted-mcp-contract";
import { createApp } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hostedMcpProcessModule } from "../../hosted-mcp.module.ts";

function process() {
  return createApp({ role: "api" })
    .withModules([hostedMcpProcessModule])
    .withMember("keyvalue", null)
    .withMember("encryption", {
      encrypt: (value: string) => value,
      decrypt: (value: string) => value,
    })
    .withConfig({ "hosted-mcp": { publicBaseUrl: "https://app.langwatch.ai" } })
    .provide({
      project: createApiFixture<ProjectApi>(),
      auth: createApiFixture<AuthApi>(),
      authz: createApiFixture<AuthzApi>(),
      governance: createApiFixture<GovernanceRestApi>(),
    });
}

describe("hosted MCP app installation", () => {
  /** @scenario "The hosted MCP feature installs from store members and peers alone" */
  it("installs a working app with no bespoke composition", async () => {
    const runtime = await process().boot();

    try {
      const app = runtime.service(HostedMcpApi);
      expect(runtime.module(hostedMcpProcessModule).provided).toBe(app);

      const handler = app.createHandler();
      expect(handler.isMcpRoute("/mcp")).toBe(true);
      await handler.closeAllSessions();
    } finally {
      await runtime.stop();
    }
  });
});

describe("hosted MCP door installation", () => {
  const doors = RawHttpHost.create();
  let stopRuntime: () => Promise<void> = () => Promise.resolve();
  let server: Server;
  let origin = "";

  beforeAll(async () => {
    const runtime = await process()
      .expose(() => ({
        hosts: { rest: { mount: () => undefined }, rawhttp: doors },
        serve: () => undefined,
      }))
      .boot();
    stopRuntime = () => runtime.stop();
    server = createServer(
      doors.ahead((_request, response) => {
        response.writeHead(404, { "Content-Type": "text/plain" }).end("routes");
      }),
    );
    await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no port bound");
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await doors.close();
    await new Promise<void>((stopped) => server.close(() => stopped()));
    await stopRuntime();
  });

  /** @scenario "The hosted MCP door mounts on the api process and its health path answers" */
  it("answers the health path through the mounted door", async () => {
    const response = await fetch(`${origin}/mcp/health`);

    expect({ status: response.status, body: await response.json() }).toEqual({
      status: 200,
      body: { status: "ok" },
    });
  });

  /** @scenario "An unpublished metadata suffix answers main's JSON 404" */
  it("answers an unpublished metadata suffix with a JSON 404", async () => {
    const response = await fetch(`${origin}/.well-known/oauth-protected-resource/elsewhere`);

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("leaves every path it does not claim to the routes", async () => {
    expect(await (await fetch(`${origin}/api/mcp/authorize`)).text()).toBe("routes");
  });
});
