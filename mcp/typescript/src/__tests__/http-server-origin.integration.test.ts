/**
 * Origin validation and bind address for the standalone MCP HTTP server.
 *
 * The MCP transport specification requires servers to validate Origin on every
 * incoming connection and to bind loopback when running locally.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";

import { initConfig } from "../config.js";
import { startHttpServer } from "../http-server.js";
import {
  countingVerifier,
  initializeBody,
  MCP_POST_HEADERS,
  startHarness,
  VALID_KEY,
  type Harness,
} from "./support/http-server-harness.js";

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
      "http://localhost:5173",
    );
  });

  it("accepts a configured origin", async () => {
    const response = await fetch(`${harness.baseUrl}/health`, {
      headers: { Origin: "https://console.example.com" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://console.example.com",
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

  it("exposes the session id header so an allowed browser origin can read it", async () => {
    const response = await fetch(`${harness.baseUrl}/health`, {
      headers: { Origin: "https://console.example.com" },
    });

    expect(
      response.headers.get("access-control-expose-headers")?.toLowerCase(),
    ).toContain("mcp-session-id");
  });

  it("sets the sniffing and framing headers a browser-reachable server needs", async () => {
    const response = await fetch(`${harness.baseUrl}/health`);

    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
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
