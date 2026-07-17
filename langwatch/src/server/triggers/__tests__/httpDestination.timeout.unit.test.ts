import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DispatchError } from "~/server/triggers/dispatchError";
import { sendHttpDestination } from "../httpDestination";

/**
 * This file deliberately does NOT mock `~/utils/ssrfProtection`. The sibling
 * unit test mocks the whole module, which is exactly why the dropped
 * `AbortSignal` went unnoticed: the request never reached undici, so nothing
 * could observe that the timeout was decorative. Here a real socket is opened
 * against a real (never-answering) server, so the bound is actually exercised.
 *
 * The SSRF validator captures BLOCK_LOCAL_HTTP_CALLS at module init, and the
 * repo `.env` sets it to `true` — which would fence off loopback before a
 * single byte moved. Mocking env at the module boundary lets the request out to
 * 127.0.0.1 without touching (or weakening) any of the fencing logic itself.
 */
vi.mock("~/env.mjs", () => ({
  env: {
    BLOCK_LOCAL_HTTP_CALLS: false,
    ALLOWED_PROXY_HOSTS: undefined,
    IS_SAAS: false,
  },
}));

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  // Accepts the connection, reads the request, then never writes a response.
  server = http.createServer(() => undefined);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

describe("sendHttpDestination against a real endpoint", () => {
  describe("when the endpoint accepts the connection but never responds", () => {
    it(
      "rejects within the requested timeout instead of riding undici's 300s default",
      async () => {
        const timeoutMs = 500;
        const startedAt = Date.now();

        const error = (await sendHttpDestination({
          url: `${baseUrl}/never-responds`,
          body: "{}",
          timeoutMs,
          contextLabel: "slowloris webhook",
        }).catch((err: unknown) => err)) as DispatchError;

        const elapsedMs = Date.now() - startedAt;

        expect(error).toBeInstanceOf(DispatchError);
        // A timeout is transient — the drainer should retry, not dead-letter.
        expect(error.retryable).toBe(true);
        expect(error.message).toContain("slowloris webhook");
        expect(elapsedMs).toBeLessThan(timeoutMs * 10);
      },
      20_000,
    );
  });
});
