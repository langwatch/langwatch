/** @vitest-environment node */
// A session outlives the replica that opened it: a deploy, an idle local copy dropped to free
// memory or a refreshed token must never end it, and a client is only sent to sign in again
// when its credential is bad. Two replicas share one record store here, as in production.
import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import { MemoryMcpOAuthClientRepository } from "../../repositories/memory/memory.mcp-oauth-client.repository.ts";
import { MemoryMcpSessionRepository } from "../../repositories/memory/memory.mcp-session.repository.ts";
import { RedisMcpOAuthTokenRepository } from "../../repositories/redis/redis.mcp-oauth-token.repository.ts";
import type { AuthzMcpSessionGrantService } from "../../services/authz-mcp-session-grant.service.ts";
import { type McpHandler, McpEndpointService } from "../../services/mcp-endpoint.service.ts";
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

const PROJECT_KEY = "lw_lifetime_key";
const PROJECT_ID = "lifetime-project";

class KeyedProjects implements Pick<ProjectMcpProjectLookupService, "resolveLiveProjectByApiKey"> {
  down = false;
  resolveLiveProjectByApiKey({ apiKey }: { apiKey: string }): Promise<McpLiveProjectLookup> {
    if (this.down) return Promise.reject(new Error("database unreachable"));
    return Promise.resolve(
      apiKey === PROJECT_KEY
        ? { kind: "live", project: { id: PROJECT_ID, teamId: "team-1" } }
        : { kind: "unknown" },
    );
  }
}

class SwitchableGrant implements Pick<AuthzMcpSessionGrantService, "stillGranted"> {
  down = false;
  stillGranted(): Promise<boolean> {
    return this.down ? Promise.reject(new Error("authz unreachable")) : Promise.resolve(true);
  }
}

class LoopbackAddress implements Pick<ResolvedMcpClientAddressService, "clientIp"> {
  clientIp(request: McpClientAddressSource): string {
    return request.clientAddress ?? "127.0.0.1";
  }
}

type Replica = { handler: McpHandler; server: Server; url: string };

const open: Replica[] = [];

/** Two replicas over one record store and one auth module, as behind a load balancer. */
function deployment() {
  const records = MemoryMcpSessionRepository.create();
  const cliSessions = new FakeCliSessions();
  const projects = new KeyedProjects();
  const grants = new SwitchableGrant();
  const replica = async (): Promise<Replica> => {
    const handler = McpEndpointService.create({
      sessionRecords: records,
      oauthTokenRecords: RedisMcpOAuthTokenRepository.create({ redis: null }),
      oauthClients: MemoryMcpOAuthClientRepository.create(),
      projects,
      grants,
      cliSessions,
      address: new LoopbackAddress(),
      baseHost: "https://app.langwatch.ai",
    });
    const server = createServer((request, response) =>
      answerMcpExchange({ endpoint: handler, runner: handler.sessionRunner, request, response }),
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const started = { handler, server, url: `http://127.0.0.1:${port}` };
    open.push(started);
    return started;
  };
  return { records, cliSessions, projects, grants, replica };
}

afterEach(async () => {
  vi.useRealTimers();
  for (const { handler, server } of open.splice(0)) {
    await handler.closeAllSessions();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "lifetime-test", version: "1.0.0" },
  },
};
const toolsList = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} };

async function post(input: {
  url: string;
  token?: string;
  sessionId?: string;
  body: unknown;
}): Promise<Response> {
  const response = await fetch(`${input.url}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(input.token ? { authorization: `Bearer ${input.token}` } : {}),
      ...(input.sessionId ? { "mcp-session-id": input.sessionId } : {}),
    },
    body: JSON.stringify(input.body),
  });
  // Read in full so the stream closes; the copy keeps the body for a refusal's code.
  const text = await response.text();
  return new Response(text, { status: response.status, headers: response.headers });
}

/** The stable code a refusal's canonical envelope carries. */
async function errorOf(response: Response): Promise<unknown> {
  const body: unknown = await response.json();
  return typeof body === "object" && body !== null && "error" in body ? body.error : undefined;
}

async function openSession(url: string, token: string): Promise<string> {
  const response = await post({ url, token, body: initialize });
  const sessionId = response.headers.get("mcp-session-id");
  if (response.status !== 200 || !sessionId) {
    throw new Error(`initialize answered ${response.status}`);
  }
  return sessionId;
}

async function personToken(cliSessions: FakeCliSessions) {
  return cliSessions.issueProjectCliSession({
    userId: "user-1",
    organizationId: "organization-1",
    projectId: PROJECT_ID,
    clientLabel: "Hosted MCP",
  });
}

describe("Feature: an MCP session outlives the replica that opened it", () => {
  describe("given a session opened on a replica that is then shut down for a deploy", () => {
    /** @scenario "A session survives the replica that opened it shutting down" */
    it("is served by the replica that takes over", async () => {
      const { replica } = deployment();
      const oldReplica = await replica();
      const newReplica = await replica();
      const sessionId = await openSession(oldReplica.url, PROJECT_KEY);

      await oldReplica.handler.closeAllSessions();
      const response = await post({
        url: newReplica.url,
        token: PROJECT_KEY,
        sessionId,
        body: toolsList,
      });

      expect(response.status).toBe(200);
    });
  });

  describe("given a client refreshed its OAuth token", () => {
    /** @scenario "A refreshed token reaches its session on a replica that never held it" */
    it("is served under the new token on a replica that never held the session", async () => {
      const { cliSessions, replica } = deployment();
      const first = await replica();
      const second = await replica();
      const issued = await personToken(cliSessions);
      const sessionId = await openSession(first.url, issued.accessToken);

      const refreshed = await cliSessions.refreshCliSession({ refreshToken: issued.refreshToken });
      cliSessions.expire(issued.accessToken);
      const response = await post({
        url: second.url,
        token: refreshed.accessToken,
        sessionId,
        body: toolsList,
      });

      expect(response.status).toBe(200);
    });
  });

  describe("given the client ended its session", () => {
    /** @scenario "Only the client ends a session" */
    it("is gone on a replica that holds no copy", async () => {
      const { replica } = deployment();
      const first = await replica();
      const second = await replica();
      const sessionId = await openSession(first.url, PROJECT_KEY);

      const ended = await fetch(`${first.url}/mcp`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${PROJECT_KEY}`, "mcp-session-id": sessionId },
      });
      const after = await post({
        url: second.url,
        token: PROJECT_KEY,
        sessionId,
        body: toolsList,
      });

      expect(ended.status).toBe(200);
      expect(after.status).toBe(404);
      expect(await errorOf(after)).toBe("Session not found");
    });
  });
});

describe("Feature: a lost session is not a sign-in failure", () => {
  describe("when a valid credential names a session nobody holds", () => {
    /** @scenario "A lost session asks for a new session, not a new sign-in" */
    it("answers 404, so the client starts a new session on the same credential", async () => {
      const { replica } = deployment();
      const { url } = await replica();

      const response = await post({ url, token: PROJECT_KEY, sessionId: "gone", body: toolsList });

      expect(response.status).toBe(404);
      expect(response.headers.get("www-authenticate")).toBeNull();
      expect(await errorOf(response)).toBe("Session not found");
    });

    it("serves a fresh initialize sent under the lost id", async () => {
      const { replica } = deployment();
      const { url } = await replica();

      const response = await post({ url, token: PROJECT_KEY, sessionId: "gone", body: initialize });

      expect(response.status).toBe(200);
      expect(response.headers.get("mcp-session-id")).toBeTruthy();
    });
  });

  describe("when the credential itself is bad", () => {
    /** @scenario "A bad credential still asks the client to sign in" */
    it("answers 401 with the sign-in challenge", async () => {
      const { replica } = deployment();
      const { url } = await replica();
      const sessionId = await openSession(url, PROJECT_KEY);

      const response = await post({ url, token: "lw_not_a_key", sessionId, body: toolsList });

      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain("resource_metadata");
      expect(await errorOf(response)).toBe("Invalid or expired token");
    });
  });

  describe("when a store the check needs is down", () => {
    /** @scenario "A store being down asks the client to retry, not to sign in" */
    it("answers 503 to an access token whose grant cannot be re-checked", async () => {
      const { cliSessions, grants, replica } = deployment();
      const { url } = await replica();
      const issued = await personToken(cliSessions);
      grants.down = true;

      const response = await post({ url, token: issued.accessToken, body: initialize });

      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("5");
      expect(await errorOf(response)).toBe("Temporarily unavailable, retry shortly");
    });

    it("answers 503 to a project key that cannot be looked up", async () => {
      const { projects, replica } = deployment();
      const { url } = await replica();
      projects.down = true;

      const response = await post({ url, token: PROJECT_KEY, body: initialize });

      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("5");
      expect(await errorOf(response)).toBe("Temporarily unavailable, retry shortly");
    });
  });
});

describe("Feature: open streams are kept alive", () => {
  describe("given a client holds the server's event stream open", () => {
    /** @scenario "An open stream is kept alive through idle-timing proxies" */
    it("receives a keepalive comment while nothing else is sent", async () => {
      vi.useFakeTimers({ toFake: ["setInterval"] });
      const { records, replica } = deployment();
      const { url } = await replica();
      const sessionId = await openSession(url, PROJECT_KEY);
      const abort = new AbortController();
      const stream = await fetch(`${url}/mcp`, {
        headers: {
          accept: "text/event-stream",
          authorization: `Bearer ${PROJECT_KEY}`,
          "mcp-session-id": sessionId,
        },
        signal: abort.signal,
      });
      const reader = stream.body!.getReader();
      const touched = vi.spyOn(records, "touch");

      vi.advanceTimersByTime(20_000);
      const { value } = await reader.read();
      abort.abort();

      expect(stream.status).toBe(200);
      expect(new TextDecoder().decode(value)).toContain(": keepalive");
      // A held stream keeps its session counting against the key's session limit.
      expect(touched).toHaveBeenCalledWith({ sessionId, apiKey: PROJECT_KEY });
    });
  });
});
