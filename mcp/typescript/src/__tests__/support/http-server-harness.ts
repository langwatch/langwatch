/**
 * Shared fixtures for the standalone MCP HTTP server tests.
 */

import { expect, vi } from "vitest";

import type { ApiKeyVerifier } from "../../http-security.js";
import { startHttpServer } from "../../http-server.js";

/** Standard headers the MCP Streamable HTTP protocol requires on POST. */
export const MCP_POST_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

export const VALID_KEY = "sk-lw-valid-key";
export const OTHER_VALID_KEY = "sk-lw-other-valid-key";

/**
 * Stands in for the LangWatch API. The standalone server has no database, so
 * it asks the API whether a key is real; here a fixed list is.
 */
export function countingVerifier(validKeys: string[]) {
  const verify = vi.fn(async (apiKey: string) => validKeys.includes(apiKey));
  const verifier: ApiKeyVerifier = {
    verify,
    sweep: () => undefined,
    clear: () => undefined,
  };
  return { verifier, verify };
}

/** A verifier whose accepted keys can change mid-test, to model revocation. */
export function revocableVerifier(initialKeys: string[]) {
  const live = new Set(initialKeys);
  const verifier: ApiKeyVerifier = {
    verify: async (apiKey: string) => live.has(apiKey),
    sweep: () => undefined,
    clear: () => undefined,
  };
  return { verifier, revoke: (apiKey: string) => live.delete(apiKey) };
}

export interface Harness {
  baseUrl: string;
  close: () => Promise<void>;
}

export async function startHarness(
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

export function initializeBody(): string {
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

export function toolsListBody(): string {
  return JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 2 });
}

/** Opens a Streamable HTTP session and returns its id. */
export async function openSession(
  baseUrl: string,
  apiKey: string = VALID_KEY
): Promise<string> {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { ...MCP_POST_HEADERS, Authorization: `Bearer ${apiKey}` },
    body: initializeBody(),
  });
  expect(response.status).toBe(200);
  await response.text();
  return response.headers.get("mcp-session-id")!;
}

/**
 * Reads an SSE stream until the endpoint event carrying the session id has
 * arrived. A single read can return a partial frame, so waiting for the
 * pattern rather than the first chunk keeps this from failing intermittently.
 */
export async function readSessionId(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffered = "";

  for (let reads = 0; reads < 20; reads++) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    const match = /sessionId=([\w-]+)/.exec(buffered);
    if (match?.[1]) return match[1];
  }

  throw new Error(`No session id in SSE stream. Received: ${buffered}`);
}

/**
 * Sends `request` repeatedly until it answers 429, and returns that response
 * along with how many attempts it took. Returns `rejected: undefined` when the
 * limit never triggered within `maxAttempts`.
 */
export async function requestUntilThrottled({
  request,
  maxAttempts = 30,
}: {
  request: (attempt: number) => Promise<Response>;
  maxAttempts?: number;
}): Promise<{ attempts: number; rejected: Response | undefined }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await request(attempt);
    if (response.status === 429) {
      return { attempts: attempt + 1, rejected: response };
    }
    await response.text();
  }
  return { attempts: maxAttempts, rejected: undefined };
}
