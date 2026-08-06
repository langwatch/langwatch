/**
 * Authorization behavior of the standalone MCP HTTP server.
 *
 * Each block below pins one guarantee that the server did not previously
 * provide: an origin allowlist, credentials never accepted from the query
 * string, a session id that authorizes nothing on its own, and no per-session
 * allocation before the key has been checked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { createServer, type Server as HttpServer } from "node:http";

import { initConfig } from "../config.js";
import {
  createApiKeyVerifier,
  type ApiKeyVerifier,
} from "../http-security.js";
import { startHttpServer } from "../http-server.js";

const MCP_POST_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

const VALID_KEY = "sk-lw-valid-key";
const OTHER_VALID_KEY = "sk-lw-other-valid-key";

function initializeBody() {
  return JSON.stringify({
    jsonrpc: "2.0",
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    },
    id: 1,
  });
}

function toolsListBody() {
  return JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 2 });
}

function countingVerifier(validKeys: string[]) {
  const verify = vi.fn(async (apiKey: string) => validKeys.includes(apiKey));
  const verifier: ApiKeyVerifier = {
    verify,
    sweep: () => undefined,
    clear: () => undefined,
  };
  return { verifier, verify };
}

interface Harness {
  baseUrl: string;
  close: () => Promise<void>;
}

async function startHarness(
  options: Parameters<typeof startHttpServer>[0]
): Promise<Harness> {
  const { server, port, host } = await startHttpServer(options);
  return {
    baseUrl: `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/** Opens a session and returns its id. */
async function openSession(baseUrl: string, apiKey = VALID_KEY) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { ...MCP_POST_HEADERS, Authorization: `Bearer ${apiKey}` },
    body: initializeBody(),
  });
  expect(response.status).toBe(200);
  await response.text();
  return response.headers.get("mcp-session-id")!;
}

beforeEach(() => {
  initConfig({ endpoint: "https://app.langwatch.ai" });
});

describe("Origin validation", () => {
  let harness: Harness;

  beforeEach(async () => {
    const { verifier } = countingVerifier([VALID_KEY]);
    harness = await startHarness({
      port: 0,
      allowedOrigins: ["https://console.example.com"],
      apiKeyVerifier: verifier,
    });
  });

  afterEach(async () => {
    await harness.close();
  });

  it("rejects a request from an origin that is not on the allowlist", async () => {
    const response = await fetch(`${harness.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        ...MCP_POST_HEADERS,
        Authorization: `Bearer ${VALID_KEY}`,
        Origin: "https://attacker.example",
      },
      body: initializeBody(),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Origin not allowed",
    });
  });

  it("rejects an unlisted origin even on the unauthenticated health endpoint", async () => {
    const response = await fetch(`${harness.baseUrl}/health`, {
      headers: { Origin: "https://attacker.example" },
    });

    expect(response.status).toBe(403);
  });

  it("rejects a rebound hostname pointing at loopback", async () => {
    // The Origin is what the browser sends, and DNS rebinding cannot change it.
    const response = await fetch(`${harness.baseUrl}/health`, {
      headers: { Origin: "http://rebind.attacker.example" },
    });

    expect(response.status).toBe(403);
  });

  it("accepts a loopback origin without configuration", async () => {
    const response = await fetch(`${harness.baseUrl}/health`, {
      headers: { Origin: "http://localhost:5173" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5173"
    );
  });

  it("accepts a configured origin", async () => {
    const response = await fetch(`${harness.baseUrl}/health`, {
      headers: { Origin: "https://console.example.com" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://console.example.com"
    );
  });

  it("never answers with a wildcard origin", async () => {
    for (const origin of [
      undefined,
      "http://localhost:5173",
      "https://console.example.com",
    ]) {
      const response = await fetch(`${harness.baseUrl}/health`, {
        headers: origin ? { Origin: origin } : {},
      });
      expect(response.headers.get("access-control-allow-origin")).not.toBe("*");
    }
  });

  it("rejects the preflight for an unlisted origin", async () => {
    const response = await fetch(`${harness.baseUrl}/mcp`, {
      method: "OPTIONS",
      headers: { Origin: "https://attacker.example" },
    });

    expect(response.status).toBe(403);
  });
});

describe("Bind address", () => {
  it("binds loopback by default", async () => {
    const { verifier } = countingVerifier([VALID_KEY]);
    const { server, host } = await startHttpServer({
      port: 0,
      apiKeyVerifier: verifier,
    });

    try {
      expect(host).toBe("127.0.0.1");
      expect((server.address() as AddressInfo).address).toBe("127.0.0.1");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("binds every interface only when asked to", async () => {
    const { verifier } = countingVerifier([VALID_KEY]);
    const { server, host } = await startHttpServer({
      port: 0,
      host: "0.0.0.0",
      apiKeyVerifier: verifier,
    });

    try {
      expect(host).toBe("0.0.0.0");
      expect((server.address() as AddressInfo).address).toBe("0.0.0.0");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("Credentials in query parameters", () => {
  let harness: Harness;

  beforeEach(async () => {
    const { verifier } = countingVerifier([VALID_KEY]);
    harness = await startHarness({ port: 0, apiKeyVerifier: verifier });
  });

  afterEach(async () => {
    await harness.close();
  });

  it("does not accept an API key from the SSE query string", async () => {
    const controller = new AbortController();

    const response = await fetch(
      `${harness.baseUrl}/sse?apiKey=${VALID_KEY}`,
      { signal: controller.signal }
    );

    expect(response.status).toBe(401);
    controller.abort();
  });

  it("does not accept an API key from the query string on /mcp", async () => {
    const response = await fetch(`${harness.baseUrl}/mcp?apiKey=${VALID_KEY}`, {
      method: "POST",
      headers: MCP_POST_HEADERS,
      body: initializeBody(),
    });

    expect(response.status).toBe(401);
  });

  it("rejects a message posted with only a session id in the query string", async () => {
    const controller = new AbortController();
    const sseResponse = await fetch(`${harness.baseUrl}/sse`, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${VALID_KEY}` },
    });
    expect(sseResponse.status).toBe(200);

    const reader = sseResponse.body!.getReader();
    const { value } = await reader.read();
    const endpoint = new TextDecoder().decode(value);
    const sessionId = /sessionId=([\w-]+)/.exec(endpoint)?.[1];
    expect(sessionId).toBeTruthy();

    const response = await fetch(
      `${harness.baseUrl}/messages?sessionId=${sessionId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: toolsListBody(),
      }
    );

    expect(response.status).toBe(401);
    controller.abort();
  });
});

describe("Session id is not a credential", () => {
  let harness: Harness;

  beforeEach(async () => {
    const { verifier } = countingVerifier([VALID_KEY, OTHER_VALID_KEY]);
    harness = await startHarness({ port: 0, apiKeyVerifier: verifier });
  });

  afterEach(async () => {
    await harness.close();
  });

  it("rejects tools/list carrying only a valid session id", async () => {
    const sessionId = await openSession(harness.baseUrl);

    const response = await fetch(`${harness.baseUrl}/mcp`, {
      method: "POST",
      headers: { ...MCP_POST_HEADERS, "mcp-session-id": sessionId },
      body: toolsListBody(),
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toContain("Authorization");
  });

  it("rejects GET /mcp carrying only a valid session id", async () => {
    const sessionId = await openSession(harness.baseUrl);

    const response = await fetch(`${harness.baseUrl}/mcp`, {
      method: "GET",
      headers: { Accept: "text/event-stream", "mcp-session-id": sessionId },
    });

    expect(response.status).toBe(401);
  });

  it("rejects DELETE /mcp carrying only a valid session id", async () => {
    const sessionId = await openSession(harness.baseUrl);

    const response = await fetch(`${harness.baseUrl}/mcp`, {
      method: "DELETE",
      headers: { "mcp-session-id": sessionId },
    });

    expect(response.status).toBe(401);

    // The session survived the unauthorized delete attempt.
    const authorized = await fetch(`${harness.baseUrl}/mcp`, {
      method: "DELETE",
      headers: {
        "mcp-session-id": sessionId,
        Authorization: `Bearer ${VALID_KEY}`,
      },
    });
    expect(authorized.status).toBe(200);
  });

  it("rejects a different valid key reusing someone else's session", async () => {
    const sessionId = await openSession(harness.baseUrl, VALID_KEY);

    const response = await fetch(`${harness.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        ...MCP_POST_HEADERS,
        "mcp-session-id": sessionId,
        Authorization: `Bearer ${OTHER_VALID_KEY}`,
      },
      body: toolsListBody(),
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toContain("does not match session");
  });

  it("still serves the session to the key that created it", async () => {
    const sessionId = await openSession(harness.baseUrl);

    const response = await fetch(`${harness.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        ...MCP_POST_HEADERS,
        "mcp-session-id": sessionId,
        Authorization: `Bearer ${VALID_KEY}`,
      },
      body: toolsListBody(),
    });

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("fetch_langwatch_docs");
  });

  it("stops serving a session once its key stops verifying", async () => {
    const live = new Set([VALID_KEY]);
    const verifier: ApiKeyVerifier = {
      verify: async (apiKey: string) => live.has(apiKey),
      sweep: () => undefined,
      clear: () => undefined,
    };
    const revocable = await startHarness({ port: 0, apiKeyVerifier: verifier });

    try {
      const sessionId = await openSession(revocable.baseUrl);

      const before = await fetch(`${revocable.baseUrl}/mcp`, {
        method: "POST",
        headers: {
          ...MCP_POST_HEADERS,
          "mcp-session-id": sessionId,
          Authorization: `Bearer ${VALID_KEY}`,
        },
        body: toolsListBody(),
      });
      expect(before.status).toBe(200);
      await before.text();

      live.delete(VALID_KEY);

      const after = await fetch(`${revocable.baseUrl}/mcp`, {
        method: "POST",
        headers: {
          ...MCP_POST_HEADERS,
          "mcp-session-id": sessionId,
          Authorization: `Bearer ${VALID_KEY}`,
        },
        body: toolsListBody(),
      });
      expect(after.status).toBe(401);
    } finally {
      await revocable.close();
    }
  });

  it("answers 401 rather than 400 for a session id it does not know", async () => {
    const response = await fetch(`${harness.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        ...MCP_POST_HEADERS,
        "mcp-session-id": "00000000-0000-0000-0000-000000000000",
        Authorization: `Bearer ${VALID_KEY}`,
      },
      body: toolsListBody(),
    });

    expect(response.status).toBe(401);
  });
});

describe("Key verification before allocation", () => {
  it("rejects an unverified bearer without creating a session", async () => {
    const { verifier, verify } = countingVerifier([VALID_KEY]);
    const harness = await startHarness({ port: 0, apiKeyVerifier: verifier });

    try {
      const response = await fetch(`${harness.baseUrl}/mcp`, {
        method: "POST",
        headers: {
          ...MCP_POST_HEADERS,
          Authorization: "Bearer totally-not-a-real-key",
        },
        body: initializeBody(),
      });

      expect(response.status).toBe(401);
      expect(response.headers.get("mcp-session-id")).toBeNull();
      expect(verify).toHaveBeenCalledWith("totally-not-a-real-key");
    } finally {
      await harness.close();
    }
  });

  it("verifies the key before the first byte of session state exists", async () => {
    const { verifier, verify } = countingVerifier([VALID_KEY]);
    const harness = await startHarness({ port: 0, apiKeyVerifier: verifier });

    try {
      await fetch(`${harness.baseUrl}/mcp`, {
        method: "POST",
        headers: { ...MCP_POST_HEADERS, Authorization: "Bearer nope" },
        body: initializeBody(),
      });

      // A rejected initialize leaves nothing behind, so a later valid
      // initialize is the first session this key gets.
      const sessionId = await openSession(harness.baseUrl);
      expect(sessionId).toBeTruthy();
      expect(verify).toHaveBeenCalledTimes(2);
    } finally {
      await harness.close();
    }
  });

  it("refuses to mint an OAuth token for an unverified client_secret", async () => {
    const { verifier } = countingVerifier([VALID_KEY]);
    const harness = await startHarness({ port: 0, apiKeyVerifier: verifier });

    try {
      const response = await fetch(`${harness.baseUrl}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials&client_secret=totally-not-a-real-key",
      });

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe("invalid_client");
    } finally {
      await harness.close();
    }
  });

  it("rate limits repeated authentication failures from one address", async () => {
    const { verifier } = countingVerifier([VALID_KEY]);
    const harness = await startHarness({ port: 0, apiKeyVerifier: verifier });

    try {
      let sawRateLimit = false;
      for (let i = 0; i < 30; i++) {
        const response = await fetch(`${harness.baseUrl}/mcp`, {
          method: "POST",
          headers: {
            ...MCP_POST_HEADERS,
            Authorization: `Bearer wrong-key-${i}`,
          },
          body: initializeBody(),
        });
        await response.text();
        if (response.status === 429) {
          sawRateLimit = true;
          break;
        }
      }

      expect(sawRateLimit).toBe(true);
    } finally {
      await harness.close();
    }
  });

  it("caps concurrent sessions for a single key", async () => {
    const { verifier } = countingVerifier([VALID_KEY]);
    const harness = await startHarness({ port: 0, apiKeyVerifier: verifier });

    try {
      let sawCap = false;
      for (let i = 0; i < 25; i++) {
        const response = await fetch(`${harness.baseUrl}/mcp`, {
          method: "POST",
          headers: {
            ...MCP_POST_HEADERS,
            Authorization: `Bearer ${VALID_KEY}`,
          },
          body: initializeBody(),
        });
        await response.text();
        if (response.status === 429) {
          sawCap = true;
          break;
        }
      }

      expect(sawCap).toBe(true);
    } finally {
      await harness.close();
    }
  });
});

describe("Verification against the LangWatch API", () => {
  let upstream: HttpServer;
  let upstreamUrl: string;
  let seenAuthHeaders: (string | undefined)[];
  let seenUrls: string[];

  beforeEach(async () => {
    seenAuthHeaders = [];
    seenUrls = [];
    upstream = createServer((req, res) => {
      seenUrls.push(req.url ?? "");
      const token = req.headers["x-auth-token"];
      seenAuthHeaders.push(typeof token === "string" ? token : undefined);

      if (token === VALID_KEY) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "p1", name: "Test", slug: "test" }));
        return;
      }
      res.writeHead(401).end();
    });

    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  it("checks a key against GET /api/me/project with the key in a header", async () => {
    const verifier = createApiKeyVerifier({ endpoint: upstreamUrl });

    await expect(verifier.verify(VALID_KEY)).resolves.toBe(true);
    await expect(verifier.verify("sk-lw-fake")).resolves.toBe(false);

    expect(seenUrls).toEqual(["/api/me/project", "/api/me/project"]);
    expect(seenAuthHeaders).toEqual([VALID_KEY, "sk-lw-fake"]);
  });

  it("end to end, only the key the API recognises gets a session", async () => {
    initConfig({ endpoint: upstreamUrl });
    const harness = await startHarness({ port: 0 });

    try {
      const rejected = await fetch(`${harness.baseUrl}/mcp`, {
        method: "POST",
        headers: { ...MCP_POST_HEADERS, Authorization: "Bearer sk-lw-fake" },
        body: initializeBody(),
      });
      expect(rejected.status).toBe(401);

      const accepted = await fetch(`${harness.baseUrl}/mcp`, {
        method: "POST",
        headers: {
          ...MCP_POST_HEADERS,
          Authorization: `Bearer ${VALID_KEY}`,
        },
        body: initializeBody(),
      });
      expect(accepted.status).toBe(200);
      expect(accepted.headers.get("mcp-session-id")).toBeTruthy();
      await accepted.text();
    } finally {
      await harness.close();
    }
  });
});
