/**
 * Nothing is allocated for a key the LangWatch API has not confirmed, and the
 * per-key and per-address limits bound what one caller can consume.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createServer, type Server as HttpServer } from "node:http";

import { initConfig } from "../config.js";
import { createApiKeyVerifier } from "../http-security.js";
import {
  countingVerifier,
  initializeBody,
  MCP_POST_HEADERS,
  openSession,
  requestUntilThrottled,
  startHarness,
  VALID_KEY,
} from "./support/http-server-harness.js";

/** Mirrors MAX_SESSIONS_PER_KEY in http-server.ts. */
const MAX_SESSIONS_PER_KEY = 20;

beforeEach(() => {
  initConfig({ endpoint: "https://app.langwatch.ai" });
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
      const sessionId = await openSession({ baseUrl: harness.baseUrl });
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
});

describe("Limits", () => {
  it("rate limits repeated authentication failures from one address", async () => {
    const { verifier } = countingVerifier([VALID_KEY]);
    const harness = await startHarness({ port: 0, apiKeyVerifier: verifier });

    try {
      const { rejected } = await requestUntilThrottled({
        request: (attempt) =>
          fetch(`${harness.baseUrl}/mcp`, {
            method: "POST",
            headers: {
              ...MCP_POST_HEADERS,
              Authorization: `Bearer wrong-key-${attempt}`,
            },
            body: initializeBody(),
          }),
      });

      expect(rejected).toBeDefined();
      await expect(rejected!.json()).resolves.toEqual({
        error: "Too many requests",
      });
    } finally {
      await harness.close();
    }
  });

  it("ignores forwarded client addresses when the proxy is not trusted", async () => {
    const previous = process.env.LANGWATCH_MCP_TRUST_PROXY;
    delete process.env.LANGWATCH_MCP_TRUST_PROXY;

    const { verifier } = countingVerifier([VALID_KEY]);
    const harness = await startHarness({ port: 0, apiKeyVerifier: verifier });

    try {
      // Every attempt claims a different client address. Untrusted, these are
      // ignored, so they all count against the one real address.
      const { rejected } = await requestUntilThrottled({
        request: (attempt) =>
          fetch(`${harness.baseUrl}/mcp`, {
            method: "POST",
            headers: {
              ...MCP_POST_HEADERS,
              Authorization: `Bearer wrong-key-${attempt}`,
              "X-Forwarded-For": `203.0.113.${attempt}`,
            },
            body: initializeBody(),
          }),
      });

      expect(rejected).toBeDefined();
    } finally {
      await harness.close();
      if (previous !== undefined) {
        process.env.LANGWATCH_MCP_TRUST_PROXY = previous;
      }
    }
  });

  it("holds the cap when initialize requests arrive together", async () => {
    const { verifier } = countingVerifier([VALID_KEY]);
    const harness = await startHarness({ port: 0, apiKeyVerifier: verifier });

    try {
      // The cap has to hold when the requests overlap, not just in sequence.
      // Admission reserves the slot before initialize is awaited, so this does
      // not depend on when the transport reports the session as initialized.
      const responses = await Promise.all(
        Array.from({ length: 40 }, () =>
          fetch(`${harness.baseUrl}/mcp`, {
            method: "POST",
            headers: {
              ...MCP_POST_HEADERS,
              Authorization: `Bearer ${VALID_KEY}`,
            },
            body: initializeBody(),
          }),
        ),
      );

      const opened = responses.filter((response) => response.status === 200);
      const refused = responses.filter((response) => response.status === 429);
      await Promise.all(responses.map((response) => response.text()));

      expect(opened.length).toBeLessThanOrEqual(MAX_SESSIONS_PER_KEY);
      expect(opened.length).toBeGreaterThan(0);
      expect(refused.length).toBe(responses.length - opened.length);
    } finally {
      await harness.close();
    }
  });

  it("caps concurrent sessions for a single key", async () => {
    const { verifier } = countingVerifier([VALID_KEY]);
    const harness = await startHarness({ port: 0, apiKeyVerifier: verifier });

    try {
      const { rejected } = await requestUntilThrottled({
        request: () =>
          fetch(`${harness.baseUrl}/mcp`, {
            method: "POST",
            headers: {
              ...MCP_POST_HEADERS,
              Authorization: `Bearer ${VALID_KEY}`,
            },
            body: initializeBody(),
          }),
      });

      expect(rejected).toBeDefined();
      // Asserting the body, not just the status, so this pins the session cap
      // rather than any 429 the server might grow later.
      const body = await rejected!.json();
      expect(body.error).toContain("Too many concurrent sessions");
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
        headers: { ...MCP_POST_HEADERS, Authorization: `Bearer ${VALID_KEY}` },
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
