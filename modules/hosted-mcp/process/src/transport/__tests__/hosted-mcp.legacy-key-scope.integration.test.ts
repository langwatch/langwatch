/** @vitest-environment node */
// A legacy project key as an MCP bearer, through the real endpoint and the real project lookup:
// admitted and logged, refused once its project is enforced, admitted silently on full access
// (modules/auth/specs/legacy-project-key-scope.feature).
import { createServer, type Server } from "node:http";

import { LEGACY_PROJECT_KEY_SCOPE_FLAGS } from "@langwatch/api-key-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { ProjectApi, ProjectIdentity } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterEach, describe, expect, it } from "vitest";

import { MemoryMcpOAuthClientRepository } from "../../repositories/memory/memory.mcp-oauth-client.repository.ts";
import { MemoryMcpSessionRepository } from "../../repositories/memory/memory.mcp-session.repository.ts";
import { RedisMcpOAuthTokenRepository } from "../../repositories/redis/redis.mcp-oauth-token.repository.ts";
import type { AuthzMcpSessionGrantService } from "../../services/authz-mcp-session-grant.service.ts";
import { type McpHandler, McpEndpointService } from "../../services/mcp-endpoint.service.ts";
import { ProjectMcpProjectLookupService } from "../../services/project-mcp-project-lookup.service.ts";
import type {
  McpClientAddressSource,
  ResolvedMcpClientAddressService,
} from "../../services/resolved-mcp-client-address.service.ts";
import { answerMcpExchange } from "../mcp-endpoint.rest.ts";
import { FakeCliSessions } from "./support/fake-cli-sessions.ts";

const LEGACY_KEY = "legacy-project-key";
const FULL_ACCESS = "legacy_project_key_full_access";
const ENFORCED = "legacy_project_key_scope_enforced";

type Line = { level: string; fields: Record<string, unknown>; message: string };
const IDENTITY: ProjectIdentity = {
  id: "project-1",
  name: "Project",
  slug: "project",
  teamId: "team-1",
  organizationId: "org-1",
  isPersonal: false,
  ownerUserId: null,
  kind: "application",
};

class GrantHolds implements Pick<AuthzMcpSessionGrantService, "stillGranted"> {
  stillGranted(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

class LoopbackAddress implements Pick<ResolvedMcpClientAddressService, "clientIp"> {
  clientIp(request: McpClientAddressSource): string {
    return request.clientAddress ?? "127.0.0.1";
  }
}

const open: { handler: McpHandler; server: Server }[] = [];

afterEach(async () => {
  for (const { handler, server } of open.splice(0)) {
    await handler.closeAllSessions();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

/** `enabled` names the flags whose rule lists the project. */
async function endpoint({
  enabled,
  lines = [],
}: {
  enabled: readonly string[];
  lines?: Line[];
}): Promise<string> {
  const handler = McpEndpointService.create({
    sessionRecords: MemoryMcpSessionRepository.create(),
    oauthTokenRecords: RedisMcpOAuthTokenRepository.create({ redis: null }),
    oauthClients: MemoryMcpOAuthClientRepository.create(),
    projects: ProjectMcpProjectLookupService.create({
      projects: createApiFixture<ProjectApi>({
        findIdByLegacyApiKey: async ({ token }) => (token === LEGACY_KEY ? IDENTITY.id : null),
        findIdentity: async () => IDENTITY,
      }),
      featureFlags: createApiFixture<FeatureFlagApi>({
        isEnabled: async (flag) => enabled.includes(flag),
      }),
      logger: {
        info: (fields: Record<string, unknown>, message: string) =>
          void lines.push({ level: "info", fields, message }),
        warn: (fields: Record<string, unknown>, message: string) =>
          void lines.push({ level: "warn", fields, message }),
      } as never,
    }),
    grants: new GrantHolds(),
    cliSessions: new FakeCliSessions(),
    address: new LoopbackAddress(),
    baseHost: "https://app.langwatch.ai",
  });
  const server = createServer((request, response) =>
    answerMcpExchange({ endpoint: handler, runner: handler.sessionRunner, request, response }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  open.push({ handler, server });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return `http://127.0.0.1:${port}`;
}

async function initialize(url: string): Promise<{ response: Response; text: string }> {
  const response = await fetch(`${url}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${LEGACY_KEY}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "legacy-key-scope", version: "1.0.0" },
      },
    }),
  });

  return { response, text: await response.text() };
}

describe("given a legacy project key as the MCP bearer", () => {
  describe("when its project is on no flag", () => {
    /** @scenario "The hosted MCP admits an unenforced project's legacy key and logs it" */
    it("opens a session and logs it outside its scopes", async () => {
      const lines: Line[] = [];
      const { response } = await initialize(await endpoint({ enabled: [], lines }));

      expect(response.status).toBe(200);
      expect(response.headers.get("mcp-session-id")).toBeTruthy();
      expect(lines[0]).toMatchObject({
        level: "warn",
        message: "legacy project key outside its scopes",
        fields: { projectId: "project-1", route: "MCP /mcp", permission: null, enforced: false },
      });
      expect(JSON.stringify(lines)).not.toContain(LEGACY_KEY);
    });
  });

  describe("when its project is enforced and not on the full-access flag", () => {
    /** @scenario "The hosted MCP refuses a legacy project key on an enforced project" */
    it("is refused 403 with the ingestion-only code and opens no session", async () => {
      const lines: Line[] = [];
      const { response, text } = await initialize(await endpoint({ enabled: [ENFORCED], lines }));

      expect(response.status).toBe(403);
      expect(JSON.parse(text)).toMatchObject({ code: "legacy_project_key_ingestion_only" });
      expect(response.headers.get("mcp-session-id")).toBeNull();
      expect(lines).toEqual([
        expect.objectContaining({ fields: expect.objectContaining({ enforced: true }) }),
      ]);
    });
  });

  describe("when its project is enforced and on every scope flag but not the full-access flag", () => {
    /** @scenario "The hosted MCP refuses a legacy project key on scope flags only" */
    it("is refused 403 with the ingestion-only code", async () => {
      const { response, text } = await initialize(
        await endpoint({ enabled: [...LEGACY_PROJECT_KEY_SCOPE_FLAGS, ENFORCED] }),
      );

      expect(response.status).toBe(403);
      expect(JSON.parse(text)).toMatchObject({ code: "legacy_project_key_ingestion_only" });
    });
  });

  describe("when its project is on the full-access flag", () => {
    /** @scenario "The hosted MCP admits a legacy project key on the full-access flag" */
    it("opens a session", async () => {
      const { response } = await initialize(await endpoint({ enabled: [FULL_ACCESS] }));

      expect(response.status).toBe(200);
      expect(response.headers.get("mcp-session-id")).toBeTruthy();
    });
  });
});
