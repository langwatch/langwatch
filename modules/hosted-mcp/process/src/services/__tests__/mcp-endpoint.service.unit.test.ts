/**
 * @vitest-environment node
 * @see modules/hosted-mcp/specs/hosted-mcp.feature
 */
import type { McpDoorRequest } from "@langwatch/hosted-mcp-contract";
import { getConfig } from "@langwatch/mcp-server/config";
import { afterAll, describe, expect, it } from "vitest";

import { MemoryHostedMcpRepositories } from "../../repositories/memory/memory.hosted-mcp.repositories.ts";
import { FakeCliSessions } from "../../transport/__tests__/support/fake-cli-sessions.ts";
import { HeaderMcpClientAddressService } from "../header-mcp-client-address.service.ts";
import { McpEndpointService } from "../mcp-endpoint.service.ts";

const BASE_HOST = "https://app.langwatch.ai";

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "unit", version: "1.0.0" },
  },
};

function endpointOver(
  overrides: Partial<Parameters<typeof McpEndpointService.create>[0]> = {},
): McpEndpointService {
  const repositories = MemoryHostedMcpRepositories.create();
  return McpEndpointService.create({
    sessionRecords: repositories.sessions,
    oauthTokenRecords: repositories.oauthTokens,
    oauthClients: repositories.oauthClients,
    projects: { resolveLiveProjectByApiKey: () => Promise.resolve({ kind: "unknown" }) },
    grants: { stillGranted: () => Promise.resolve(false) },
    cliSessions: new FakeCliSessions(),
    address: HeaderMcpClientAddressService.create(),
    baseHost: BASE_HOST,
    ...overrides,
  });
}

const LIVE_PROJECT = {
  resolveLiveProjectByApiKey: () =>
    Promise.resolve({ kind: "live" as const, project: { id: "project-1", teamId: "team-1" } }),
};

const endpoint = endpointOver();
const opened: McpEndpointService[] = [endpoint];

afterAll(async () => {
  for (const each of opened) await each.closeAllSessions();
});

function request(input: Partial<McpDoorRequest> & { url: string }): McpDoorRequest {
  return {
    method: "GET",
    headers: {},
    remoteAddress: "127.0.0.1",
    readBody: () => Promise.resolve({ kind: "read", body: "" }),
    ...input,
  };
}

function initialize(headers: McpDoorRequest["headers"]): McpDoorRequest {
  return request({
    method: "POST",
    url: "/mcp",
    headers: { "content-type": "application/json", ...headers },
    readBody: () => Promise.resolve({ kind: "read", body: JSON.stringify(INITIALIZE) }),
  });
}

async function answerOf(input: McpDoorRequest) {
  return (await endpoint.answer(input)).answer;
}

describe("McpEndpointService", () => {
  describe("when asked about the health path as plain values", () => {
    /** @scenario "The endpoint answers a request without touching the response" */
    it("answers 200 with status ok and the CORS headers, as data", async () => {
      const health = request({ url: "/mcp/health?probe=1" });

      await expect(answerOf(health)).resolves.toEqual({
        kind: "json",
        status: 200,
        headers: expect.objectContaining({ "Access-Control-Allow-Origin": "*" }),
        body: { status: "ok" },
      });
    });
  });

  describe("when an OPTIONS request reaches an MCP path", () => {
    /** @scenario "A preflight on an MCP path answers with the CORS headers alone" */
    it("answers an empty 200 with the CORS headers", async () => {
      const answer = await answerOf(request({ method: "OPTIONS", url: "/mcp" }));

      expect(answer).toEqual({
        kind: "empty",
        status: 200,
        headers: expect.objectContaining({
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Expose-Headers": "mcp-session-id",
        }),
      });
    });
  });

  describe("when a request names a path or a method the endpoint does not serve", () => {
    /** @scenario "An unknown path or method is refused in the endpoint's own shape" */
    it("answers 404 for the path and 405 for the method", async () => {
      const unknown = await answerOf(request({ url: "/mcp/nowhere" }));
      const wrongVerb = await answerOf(request({ method: "PUT", url: "/oauth/token" }));
      const wrongSubtreeVerb = await answerOf(
        request({ method: "POST", url: "/.well-known/oauth-protected-resource/mcp" }),
      );

      expect(
        [unknown, wrongVerb, wrongSubtreeVerb].map(
          (answer) => answer.kind === "json" && answer.status,
        ),
      ).toEqual([404, 405, 405]);
    });
  });

  describe("when a path-suffixed discovery document is asked for", () => {
    it("answers the resource metadata for that suffix", async () => {
      const answer = await answerOf(request({ url: "/.well-known/oauth-protected-resource/mcp" }));

      expect(answer).toMatchObject({
        kind: "json",
        status: 200,
        body: { resource: `${BASE_HOST}/mcp` },
      });
    });
  });

  describe("when an initialize request arrives with no bearer", () => {
    /** @scenario "A request without a bearer is told where to sign in" */
    it("answers 401 naming the protected resource metadata", async () => {
      const answer = await answerOf(initialize({}));

      expect(answer).toMatchObject({
        kind: "json",
        status: 401,
        headers: {
          "WWW-Authenticate": `Bearer resource_metadata="${BASE_HOST}/.well-known/oauth-protected-resource"`,
        },
        body: { error: "Authorization required" },
      });
    });
  });

  describe("when reading the body fails while deciding", () => {
    /** @scenario "A failure while deciding answers in the endpoint's shape rather than rejecting" */
    it("answers 500 rather than rejecting", async () => {
      const answer = await answerOf(
        request({
          method: "POST",
          url: "/mcp",
          readBody: () => Promise.reject(new Error("socket reset")),
        }),
      );

      expect(answer).toMatchObject({
        kind: "json",
        status: 500,
        body: { error: "Internal server error" },
      });
    });
  });

  describe("when a request is answered", () => {
    /** @scenario "The endpoint names the access log fields beside its answer" */
    it("returns what was asked, who asked and the identifiers met, but no status", async () => {
      const reply = await endpoint.answer(
        request({
          url: "/mcp/health?probe=1",
          headers: { "mcp-session-id": "s-1", "user-agent": "claude-code/2.0" },
        }),
      );

      expect(reply.accessLog).toMatchObject({
        method: "GET",
        path: "/mcp/health",
        userAgent: "claude-code/2.0",
        endpointClass: expect.any(String),
        sessionId: "s-1",
      });
      expect(reply.accessLog).not.toHaveProperty("status");
      expect(reply.accessLog).not.toHaveProperty("durationMs");
    });
  });

  describe("when an authenticated initialize opens a session", () => {
    /** @scenario "A stream answer is data: the SDK transport and the session key" */
    it("answers the transport, the key and the body, and no function to run them", async () => {
      const live = endpointOver({ projects: LIVE_PROJECT });
      opened.push(live);

      const { answer } = await live.answer(initialize({ authorization: "Bearer sk-project" }));

      expect(answer).toMatchObject({
        kind: "stream",
        headers: { "X-Accel-Buffering": "no", "Access-Control-Allow-Origin": "*" },
        stream: { apiKey: "sk-project", body: INITIALIZE },
      });
      const stream = answer.kind === "stream" ? answer.stream : undefined;
      expect(Object.keys(stream ?? {}).toSorted()).toEqual(["apiKey", "body", "transport"]);
    });
  });

  describe("when the door runs a stream through the endpoint's session runner", () => {
    /** @scenario "The door drives a stream through the session runner it was handed" */
    it("runs the work as the session's key", async () => {
      const key = await endpoint.sessionRunner.runAs("sk-session", () =>
        Promise.resolve(getConfig().apiKey),
      );

      expect(key).toBe("sk-session");
    });
  });

  describe("when the session's server fails to start", () => {
    /** @scenario "A stream that fails to start keeps its unbuffered header" */
    it("answers 500 with X-Accel-Buffering, as the stream would have", async () => {
      const failing = endpointOver({
        projects: LIVE_PROJECT,
        sessionTools: {
          registerMcpTools: () => {
            throw new Error("tools unavailable");
          },
        },
      });
      opened.push(failing);

      const { answer } = await failing.answer(initialize({ authorization: "Bearer sk-project" }));

      expect(answer).toMatchObject({
        kind: "json",
        status: 500,
        headers: { "X-Accel-Buffering": "no" },
        body: { error: "Internal server error" },
      });
    });
  });
});
