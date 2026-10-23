/**
 * @vitest-environment node
 * The hosted MCP endpoint counts each authenticated request into the credential census as
 * client hosted-mcp, by the kind of bearer it was sent, never the bearer itself.
 * @see modules/auth/specs/request-credential-census.feature
 */
import { createServer, type Server } from "node:http";

import type * as Census from "@langwatch/observability/credential-census";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryMcpOAuthClientRepository } from "../../repositories/memory/memory.mcp-oauth-client.repository.ts";
import { MemoryMcpSessionRepository } from "../../repositories/memory/memory.mcp-session.repository.ts";
import { RedisMcpOAuthTokenRepository } from "../../repositories/redis/redis.mcp-oauth-token.repository.ts";
import type { AuthzMcpSessionGrantService } from "../../services/authz-mcp-session-grant.service.ts";
import { McpEndpointService, type McpHandler } from "../../services/mcp-endpoint.service.ts";
import type {
  McpLiveProjectLookup,
  ProjectMcpProjectLookupService,
} from "../../services/project-mcp-project-lookup.service.ts";
import type {
  McpClientAddressSource,
  ResolvedMcpClientAddressService,
} from "../../services/resolved-mcp-client-address.service.ts";
import { answerMcpExchange } from "../mcp-endpoint.rest.ts";
import { FakeCliSessions } from "./support/fake-cli-sessions.ts";

const counted = vi.hoisted(() => [] as Census.CensusRequest[]);

vi.mock("@langwatch/observability/credential-census", async (importOriginal) => {
  const actual = await importOriginal<typeof Census>();
  return {
    ...actual,
    recordCredentialCensus: (request: Census.CensusRequest) => counted.push(request),
  };
});

const LEGACY_KEY = "sk-lw-census-legacy-key";

class CensusProjectLookup implements Pick<
  ProjectMcpProjectLookupService,
  "resolveLiveProjectByApiKey"
> {
  resolveLiveProjectByApiKey({ apiKey }: { apiKey: string }): Promise<McpLiveProjectLookup> {
    return Promise.resolve(
      apiKey === LEGACY_KEY
        ? { kind: "live", project: { id: "census-project", teamId: "team-1" } }
        : { kind: "unknown" },
    );
  }
}

class AlwaysGranted implements Pick<AuthzMcpSessionGrantService, "stillGranted"> {
  stillGranted(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

class LoopbackAddress implements Pick<ResolvedMcpClientAddressService, "clientIp"> {
  clientIp(request: McpClientAddressSource): string {
    return request.clientAddress ?? "127.0.0.1";
  }
}

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "census-test", version: "1.0.0" },
  },
};

/** The census line is counted when the response closes. */
async function countedFor(path: string): Promise<Census.CensusRequest[]> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const lines = counted.filter((line) => line.route === path);
    if (lines.length > 0) return lines;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return [];
}

describe("the credential census on the hosted MCP endpoint", () => {
  let server: Server;
  let handler: McpHandler;
  let baseUrl: string;

  beforeAll(async () => {
    handler = McpEndpointService.create({
      sessionRecords: MemoryMcpSessionRepository.create(),
      oauthTokenRecords: RedisMcpOAuthTokenRepository.create({ redis: null }),
      oauthClients: MemoryMcpOAuthClientRepository.create(),
      projects: new CensusProjectLookup(),
      grants: new AlwaysGranted(),
      cliSessions: new FakeCliSessions(),
      address: new LoopbackAddress(),
      baseHost: "https://app.langwatch.ai",
    });
    server = createServer((request, response) =>
      answerMcpExchange({ endpoint: handler, runner: handler.sessionRunner, request, response }),
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  });

  afterAll(async () => {
    await handler.closeAllSessions();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    counted.length = 0;
  });

  const post = (bearer: string) =>
    fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "user-agent": "claude-desktop/1.0",
      },
      body: JSON.stringify(initialize),
    }).then((response) => response.text().then(() => response.status));

  describe("given a legacy project key", () => {
    /** @scenario "A hosted MCP request is counted with client hosted-mcp" */
    it("counts the request as a legacy key from hosted-mcp, without the key", async () => {
      expect(await post(LEGACY_KEY)).toBe(200);

      const lines = await countedFor("/mcp");
      expect(lines).toEqual([
        expect.objectContaining({
          credentialType: "legacy_project_key",
          projectId: "census-project",
          method: "POST",
          route: "/mcp",
          client: "hosted-mcp",
          userAgent: "claude-desktop/1.0",
          status: 200,
        }),
      ]);
      expect(JSON.stringify(lines)).not.toContain(LEGACY_KEY);
    });
  });

  describe("given a bearer that resolves no project", () => {
    it("counts nothing", async () => {
      expect(await post("sk-lw-unknown")).toBe(401);

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(counted).toEqual([]);
    });
  });
});
