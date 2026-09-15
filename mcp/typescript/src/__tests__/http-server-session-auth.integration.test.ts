/**
 * A session id must authorize nothing on its own, and credentials must never
 * be accepted from the query string.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initConfig } from "../config.js";
import {
  countingVerifier,
  MCP_POST_HEADERS,
  openSession,
  OTHER_VALID_KEY,
  readSessionId,
  revocableVerifier,
  startHarness,
  toolsListBody,
  VALID_KEY,
  initializeBody,
  type Harness,
} from "./support/http-server-harness.js";

beforeEach(() => {
  initConfig({ endpoint: "https://app.langwatch.ai" });
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

    const response = await fetch(`${harness.baseUrl}/sse?apiKey=${VALID_KEY}`, {
      signal: controller.signal,
    });

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

    const sessionId = await readSessionId(sseResponse);

    const response = await fetch(`${harness.baseUrl}/messages?sessionId=${sessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: toolsListBody(),
    });

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
    const sessionId = await openSession({ baseUrl: harness.baseUrl });

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
    const sessionId = await openSession({ baseUrl: harness.baseUrl });

    const response = await fetch(`${harness.baseUrl}/mcp`, {
      method: "GET",
      headers: { Accept: "text/event-stream", "mcp-session-id": sessionId },
    });

    expect(response.status).toBe(401);
  });

  it("rejects DELETE /mcp carrying only a valid session id", async () => {
    const sessionId = await openSession({ baseUrl: harness.baseUrl });

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

  it("accepts a lowercase bearer scheme, which RFC 7235 allows", async () => {
    const sessionId = await openSession({ baseUrl: harness.baseUrl });

    const response = await fetch(`${harness.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        ...MCP_POST_HEADERS,
        "mcp-session-id": sessionId,
        Authorization: `bearer ${VALID_KEY}`,
      },
      body: toolsListBody(),
    });

    expect(response.status).toBe(200);
    await response.text();
  });

  it("tolerates extra spaces between the scheme and the token", async () => {
    const sessionId = await openSession({ baseUrl: harness.baseUrl });

    const response = await fetch(`${harness.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        ...MCP_POST_HEADERS,
        "mcp-session-id": sessionId,
        Authorization: `Bearer    ${VALID_KEY}`,
      },
      body: toolsListBody(),
    });

    expect(response.status).toBe(200);
    await response.text();
  });

  it("rejects an Authorization header carrying no token", async () => {
    const sessionId = await openSession({ baseUrl: harness.baseUrl });

    for (const header of ["Bearer", `Basic ${VALID_KEY}`, `Bearer${VALID_KEY}`]) {
      const response = await fetch(`${harness.baseUrl}/mcp`, {
        method: "POST",
        headers: {
          ...MCP_POST_HEADERS,
          "mcp-session-id": sessionId,
          Authorization: header,
        },
        body: toolsListBody(),
      });

      expect(response.status).toBe(401);
      await response.text();
    }
  });

  it("does not reveal whether another key's session exists", async () => {
    const sessionId = await openSession({ baseUrl: harness.baseUrl, apiKey: VALID_KEY });

    const someoneElses = await fetch(`${harness.baseUrl}/mcp`, {
      method: "DELETE",
      headers: {
        "mcp-session-id": sessionId,
        Authorization: `Bearer ${OTHER_VALID_KEY}`,
      },
    });

    const neverExisted = await fetch(`${harness.baseUrl}/mcp`, {
      method: "DELETE",
      headers: {
        "mcp-session-id": "00000000-0000-0000-0000-000000000000",
        Authorization: `Bearer ${OTHER_VALID_KEY}`,
      },
    });

    // Same status for "not yours" and "does not exist", so the response is not
    // an existence oracle for session ids.
    expect(someoneElses.status).toBe(404);
    expect(neverExisted.status).toBe(404);
    expect(await someoneElses.json()).toEqual(await neverExisted.json());
  });

  it("rejects a different valid key reusing someone else's session", async () => {
    const sessionId = await openSession({ baseUrl: harness.baseUrl, apiKey: VALID_KEY });

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
    const sessionId = await openSession({ baseUrl: harness.baseUrl });

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

describe("Revoking a key ends its sessions", () => {
  it("stops serving a Streamable HTTP session once its key stops verifying", async () => {
    const { verifier, revoke } = revocableVerifier([VALID_KEY]);
    const harness = await startHarness({ port: 0, apiKeyVerifier: verifier });

    try {
      const sessionId = await openSession({ baseUrl: harness.baseUrl });
      const call = () =>
        fetch(`${harness.baseUrl}/mcp`, {
          method: "POST",
          headers: {
            ...MCP_POST_HEADERS,
            "mcp-session-id": sessionId,
            Authorization: `Bearer ${VALID_KEY}`,
          },
          body: toolsListBody(),
        });

      const before = await call();
      expect(before.status).toBe(200);
      await before.text();

      revoke(VALID_KEY);

      const after = await call();
      expect(after.status).toBe(401);
      await after.text();
    } finally {
      await harness.close();
    }
  });

  it("stops serving an SSE session once its key stops verifying", async () => {
    const { verifier, revoke } = revocableVerifier([VALID_KEY]);
    const harness = await startHarness({ port: 0, apiKeyVerifier: verifier });
    const controller = new AbortController();

    try {
      const sse = await fetch(`${harness.baseUrl}/sse`, {
        signal: controller.signal,
        headers: { Authorization: `Bearer ${VALID_KEY}` },
      });
      expect(sse.status).toBe(200);

      const sessionId = await readSessionId(sse);
      const post = () =>
        fetch(`${harness.baseUrl}/messages?sessionId=${sessionId}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${VALID_KEY}`,
          },
          body: toolsListBody(),
        });

      const before = await post();
      expect(before.status).toBeLessThan(400);
      await before.text();

      revoke(VALID_KEY);

      const after = await post();
      expect(after.status).toBe(401);
      await after.text();
    } finally {
      controller.abort();
      await harness.close();
    }
  });
});
