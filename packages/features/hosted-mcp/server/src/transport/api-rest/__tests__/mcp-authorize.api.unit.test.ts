/**
 * @vitest-environment node
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

async function approve(
  app: ReturnType<typeof createMcpAuthorizeRestApp>,
  overrides: Record<string, unknown> = {},
) {
  const body: Record<string, unknown> = {
    projectId: PROJECT_ID,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_challenge: "a".repeat(43),
    code_challenge_method: "S256",
    state: "xyz",
    ...overrides,
  };
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined) delete body[key];
  }
  return await app.request("/api/mcp/authorize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The auth-code keys the flow wrote, which is what "minted nothing" means. */
function mintedCodes(stored: Map<string, string>): string[] {
  return [...stored.keys()].filter((key) => key.startsWith("mcp:auth_code:"));
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

/**
 * RFC 6749 §10.6. The authorize step used to accept ANY redirect_uri regardless of what the
 * client registered, so whoever crafted the authorization request — not necessarily the person
 * who clicks Allow — could have the approved code delivered to a domain they control. PKCE
 * does not defend against it: the same attacker authored the challenge.
 */
describe("given an authorization request naming a client and a redirect URI", () => {
  const mount = (harness: ReturnType<typeof ports>) =>
    createMcpAuthorizeRestApp({ security: passThroughSecurity(), ports: harness.ports });

  describe("when the redirect URI is exactly one the client registered", () => {
    /** @scenario "Authorization succeeds when redirect_uri exactly matches the registered client" */
    it("issues an authorization code", async () => {
      const harness = ports({ held: ["project:update"] });

      const response = await approve(mount(harness));

      expect(response.status).toBe(200);
      expect(((await response.json()) as { redirect: string }).redirect).toContain("code=");
    });
  });

  describe("when the redirect URI is not one the client registered", () => {
    /** @scenario "Authorization is rejected when redirect_uri does not match the registered client" */
    it("refuses it and never mints a code", async () => {
      const harness = ports({ held: ["project:update"] });

      const response = await approve(mount(harness), {
        redirect_uri: "https://attacker.invalid/callback",
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string; redirect?: string };
      expect(body.error).toContain("does not match");
      // Nothing is ever sent to an unverified redirect URI: that URI is
      // exactly what an attacker would have supplied.
      expect(body.redirect).toBeUndefined();
      expect(mintedCodes(harness.stored)).toEqual([]);
    });
  });

  describe.each([
    "javascript:alert(1)",
    "vbscript:msgbox(1)",
    "data:text/html,<script>alert(1)</script>",
    "blob:https://app.langwatch.ai/00000000-0000-4000-8000-000000000000",
    "filesystem:https://app.langwatch.ai/temporary/x",
  ])("when the redirect URI is %s", (redirect_uri) => {
    /** @scenario "Authorization is rejected when redirect_uri uses a scheme the browser executes" */
    it("refuses it before the client registry is consulted", async () => {
      const harness = ports({ held: ["project:update"] });

      const response = await approve(mount(harness), { redirect_uri });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string; redirect?: string };
      expect(body.error).toContain("disallowed scheme");
      expect(body.redirect).toBeUndefined();
      expect(mintedCodes(harness.stored)).toEqual([]);
    });
  });

  describe("when the client was never registered", () => {
    /** @scenario "Authorization is rejected for an unregistered client_id" */
    it("refuses it and never mints a code", async () => {
      const harness = ports({ held: ["project:update"] });

      const response = await approve(mount(harness), { client_id: "mcp_never_registered" });

      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toBe(
        "Unknown or unregistered client_id",
      );
      expect(mintedCodes(harness.stored)).toEqual([]);
    });
  });

  describe("when the request names no client at all", () => {
    /** @scenario "Authorization is rejected when client_id is missing" */
    it("refuses it before any registration is looked up", async () => {
      const harness = ports({ held: ["project:update"] });

      const response = await approve(mount(harness), { client_id: undefined });

      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toContain("client_id");
      expect(mintedCodes(harness.stored)).toEqual([]);
    });
  });
});

/**
 * RFC 6749 §4.1.2.1: once the client is verified and the presented redirect URI is one it
 * registered, a failure belongs back at that URI as an OAuth error. The advertised authorize
 * endpoint is a page in this application, so a failure rendered only here leaves the client's
 * popup waiting forever with nothing to report.
 */
describe("given a verified client whose approval then fails", () => {
  const mount = (harness: ReturnType<typeof ports>) =>
    createMcpAuthorizeRestApp({ security: passThroughSecurity(), ports: harness.ports });

  describe("when the request carries no code challenge", () => {
    /** @scenario "A consent failure a client can be told about is redirected back to the client" */
    it("sends the browser back to the registered redirect URI with the OAuth error", async () => {
      const harness = ports({ held: ["project:update"] });

      const response = await approve(mount(harness), { code_challenge: undefined });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string; redirect: string };
      expect(body.error).toBe("invalid_request");
      const redirect = new URL(body.redirect);
      expect(redirect.origin + redirect.pathname).toBe(REDIRECT_URI);
      expect(redirect.searchParams.get("error")).toBe("invalid_request");
      expect(redirect.searchParams.get("error_description")).toContain("code_challenge");
      expect(redirect.searchParams.get("state")).toBe("xyz");
      expect(redirect.searchParams.get("code")).toBeNull();
      expect(mintedCodes(harness.stored)).toEqual([]);
    });
  });

  describe("when the request asks for a code challenge method other than S256", () => {
    /**
     * The token endpoint verifies every code as S256 whatever was requested, so accepting
     * another method here would mint a code that can never be redeemed.
     */
    /** @scenario "A code challenge method other than S256 is refused at the authorization request" */
    it("refuses it now rather than at the exchange", async () => {
      const harness = ports({ held: ["project:update"] });

      const response = await approve(mount(harness), { code_challenge_method: "plain" });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string; redirect: string };
      expect(body.error).toBe("invalid_request");
      expect(new URL(body.redirect).searchParams.get("error_description")).toContain(
        "code_challenge_method",
      );
      expect(mintedCodes(harness.stored)).toEqual([]);
    });
  });

  describe("when the approving person cannot reach the project", () => {
    /** @scenario "A project the user cannot reach is reported to the client as access denied" */
    it("answers access_denied and carries it back to the client", async () => {
      const harness = ports({ held: [] });

      const response = await approve(mount(harness));

      expect(response.status).toBe(403);
      const body = (await response.json()) as { error: string; redirect: string };
      expect(body.error).toBe("access_denied");
      expect(new URL(body.redirect).searchParams.get("error")).toBe("access_denied");
      expect(mintedCodes(harness.stored)).toEqual([]);
    });
  });
});

describe("given a failure the client cannot be told about", () => {
  describe("when the redirect URI was never verified against a registration", () => {
    /** @scenario "A consent failure that cannot be attributed to a client stays on the LangWatch page" */
    it("carries no redirect for the browser to follow", async () => {
      const harness = ports({ held: ["project:update"] });
      const app = createMcpAuthorizeRestApp({
        security: passThroughSecurity(),
        ports: harness.ports,
      });

      const unregisteredClient = await approve(app, { client_id: "mcp_never_registered" });
      const foreignRedirect = await approve(app, {
        redirect_uri: "https://attacker.invalid/callback",
      });

      for (const response of [unregisteredClient, foreignRedirect]) {
        expect((await response.json()) as { redirect?: string }).not.toHaveProperty("redirect");
      }
      expect(mintedCodes(harness.stored)).toEqual([]);
    });
  });
});
