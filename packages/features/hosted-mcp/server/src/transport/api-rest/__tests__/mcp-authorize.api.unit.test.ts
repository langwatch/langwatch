/**
 * @vitest-environment node
 *
 * The approval step of the hosted MCP OAuth flow mints a code carrying the
 * project's legacy API key, so what it demands has to match what it confers.
 * Covers specs/security/hosted-mcp-grant-fidelity.feature.
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createMcpAuthorizeRestApp,
  MCP_AUTHORIZE_PERMISSION,
  type McpAuthorizeRestPorts,
} from "../mcp-authorize.api";
import type { HostedMcpRedis } from "../../../ports/hosted-mcp.port";

const PROJECT_ID = "project-1";
const CLIENT_ID = "mcp_client_1";
const REDIRECT_URI = "http://127.0.0.1:9999/cb";

const renderUnexpected = (
  error: unknown,
  c: { json: (body: unknown, status: number) => Response },
) => c.json({ error: String(error) }, 500);

function passThroughSecurity(): AppRestSecurity {
  const noop = async (_c: unknown, next: () => Promise<void>) => {
    await next();
  };
  const unreachable = () => {
    throw new Error("This family resolves its own credential.");
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderUnexpected,
    canonicalErrorHandler: renderUnexpected,
    authenticateProject: unreachable,
    authorizeProjectPermission: unreachable,
    authorizeApiKeyCeiling: unreachable,
    authenticateOrganization: unreachable,
    authorizeOrganizationPermission: unreachable,
    authorizeRouteTeamPermission: unreachable,
    authorizeRouteProjectPermission: unreachable,
    authenticateOrganizationThrowing: noop,
    authorizeOrganizationPermissionThrowing: unreachable,
  } as never);
}

/** The Redis this flow reaches: the client registry, and where a code lands. */
function fakeRedis() {
  const stored = new Map<string, string>();
  stored.set(
    `mcp:oauth:client:${CLIENT_ID}`,
    JSON.stringify({ redirectUris: [REDIRECT_URI], clientName: "test" }),
  );
  return {
    stored,
    redis: {
      get: (key: string) => Promise.resolve(stored.get(key) ?? null),
      set: (key: string, value: string) => {
        stored.set(key, value);
        return Promise.resolve("OK");
      },
    } as unknown as HostedMcpRedis,
  };
}

function ports(options: { held: readonly string[] }): {
  ports: McpAuthorizeRestPorts;
  probed: string[];
  stored: Map<string, string>;
} {
  const { redis, stored } = fakeRedis();
  const probed: string[] = [];
  return {
    probed,
    stored,
    ports: {
      resolveSession: () => Promise.resolve({ user: { id: "user-1" } }),
      tryGetProject: () =>
        Promise.resolve({ id: PROJECT_ID, apiKey: "lw_project_key", archivedAt: null }),
      probeProjectPermission: (input) => {
        probed.push(input.permission);
        return Promise.resolve(options.held.includes(input.permission));
      },
      isDemoProject: () => false,
      encrypt: (value: string) => `encrypted:${value}`,
      redis,
    },
  };
}

async function approve(app: ReturnType<typeof createMcpAuthorizeRestApp>) {
  return await app.request("/api/mcp/authorize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      projectId: PROJECT_ID,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_challenge: "a".repeat(43),
      code_challenge_method: "S256",
    }),
  });
}

describe("given the hosted MCP approval step", () => {
  let harness: ReturnType<typeof ports>;

  const mount = (held: readonly string[]) => {
    harness = ports({ held });
    return createMcpAuthorizeRestApp({ security: passThroughSecurity(), ports: harness.ports });
  };

  beforeEach(() => {
    harness = ports({ held: [] });
  });

  describe("when the approving person may only view the project", () => {
    // @scenario "A project viewer cannot mint an MCP authorization code"
    it("refuses the approval and stores no authorization code", async () => {
      const app = mount(["project:view"]);

      const response = await approve(app);

      expect(response.status).toBe(403);
      expect(((await response.json()) as { error: string }).error).toBe("access_denied");
      expect([...harness.stored.keys()].filter((key) => key.startsWith("mcp:auth_code:"))).toEqual(
        [],
      );
    });
  });

  describe("when the approval is evaluated", () => {
    // @scenario "The approval step names the update grain, not the view grain"
    it("probes the permission that reveals the project's API key", async () => {
      const app = mount(["project:update"]);

      await approve(app);

      expect(harness.probed).toEqual(["project:update"]);
      expect(MCP_AUTHORIZE_PERMISSION).toBe("project:update");
    });
  });

  describe("when the approving person may update the project", () => {
    // @scenario "A person who may update the project mints a code"
    it("stores a code bound to the client and redirect URI it approved", async () => {
      const app = mount(["project:update"]);

      const response = await approve(app);

      expect(response.status).toBe(200);
      const codes = [...harness.stored.entries()].filter(([key]) =>
        key.startsWith("mcp:auth_code:"),
      );
      expect(codes).toHaveLength(1);
      const code = JSON.parse(codes[0]![1]) as Record<string, unknown>;
      expect(code).toMatchObject({
        projectId: PROJECT_ID,
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
        userId: "user-1",
      });
    });
  });
});
