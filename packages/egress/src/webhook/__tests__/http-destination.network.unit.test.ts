import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { DispatchError } from "@langwatch/eventing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchValidatedDestination, RedirectRefusedError } from "../../ssrf/fenced-fetch";
import { createSsrfUrlValidator } from "../../ssrf/url-validator";
import { sendHttpDestination } from "../http-destination";

/**
 * Spec: packages/egress/specs/webhook-egress.feature
 *
 * Executed regressions, against a REAL local server through the REAL fence, no
 * mocks: a redirect refusal that only ever existed as a string assertion would
 * pass just as happily while the hop was being taken.
 *
 * The address policy here is deliberately permissive so the test can reach
 * 127.0.0.1 at all. Redirect refusal is orthogonal to the private-address rules,
 * which `url-policy.unit.test.ts` and `url-validator.unit.test.ts` pin.
 */

const validateUrl = createSsrfUrlValidator({ blockLocal: false, allowedHosts: [] });
const tls = { rejectUnauthorized: false };

let server: Server;
let baseUrl: string;
const seenPaths: string[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    seenPaths.push(request.url ?? "");
    if (request.url === "/redirect-to-metadata") {
      response.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data/" });
      response.end();
    } else if (request.url === "/bare-3xx") {
      response.writeHead(304);
      response.end();
    } else if (request.url === "/never-responds") {
      // Accepts the connection, reads the request, then writes nothing.
    } else {
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end("ok");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

const send = (path: string, timeoutMs?: number) =>
  sendHttpDestination({
    url: `${baseUrl}${path}`,
    body: "{}",
    contextLabel: "redirect test",
    validateUrl,
    tls,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });

describe("sendHttpDestination against a real receiver", () => {
  describe("when the receiver redirects toward another address", () => {
    /** @scenario "A redirect is refused rather than followed" */
    it("refuses the hop permanently without contacting the address it named", async () => {
      seenPaths.length = 0;

      const error = (await send("/redirect-to-metadata").catch(
        (err: unknown) => err,
      )) as DispatchError;

      expect(error).toBeInstanceOf(DispatchError);
      expect(error.retryable).toBe(false);
      expect(error.message).toMatch(/redirect/i);
      // Exactly one request reached the local server; the metadata Location was
      // never contacted, which a hop would have shown as a second entry.
      expect(seenPaths).toEqual(["/redirect-to-metadata"]);
    });
  });

  describe("when the receiver answers a 3xx with no location", () => {
    /** @scenario "A redirect with no location is the receiver's answer, not a hop" */
    it("returns the status for the caller to classify", async () => {
      await expect(send("/bare-3xx")).resolves.toMatchObject({ status: 304 });
    });
  });

  describe("when the receiver answers normally", () => {
    /** @scenario "A send refuses a fenced address before it opens a connection" */
    it("delivers through the fence and reads the answer", async () => {
      await expect(send("/ok")).resolves.toMatchObject({ status: 200, body: "ok" });
    });
  });

  describe("when the receiver accepts the connection and never answers", () => {
    /** @scenario "A slow receiver is abandoned at the timeout, retryably" */
    it("gives up inside the request timeout rather than riding undici's default", async () => {
      const timeoutMs = 500;
      const startedAt = Date.now();

      const error = (await send("/never-responds", timeoutMs).catch(
        (err: unknown) => err,
      )) as DispatchError;

      expect(error).toBeInstanceOf(DispatchError);
      // A timeout is transient — the queue should retry, not dead-letter.
      expect(error.retryable).toBe(true);
      expect(error.message).toContain("redirect test");
      expect(Date.now() - startedAt).toBeLessThan(timeoutMs * 10);
    }, 20_000);
  });
});

describe("the fenced fetch asked to follow a redirect", () => {
  describe("when the caller named no policy for the next hop", () => {
    /** @scenario "A redirect cannot be followed without a policy to judge the hop" */
    it("refuses the hop rather than taking it on the receiver's say-so", async () => {
      seenPaths.length = 0;
      const validated = await validateUrl(`${baseUrl}/redirect-to-metadata`);

      await expect(
        fetchValidatedDestination(validated, { method: "POST", body: "{}" }, tls),
      ).rejects.toBeInstanceOf(RedirectRefusedError);
      expect(seenPaths).toEqual(["/redirect-to-metadata"]);
    });
  });

  describe("when the caller named a policy that refuses the next hop", () => {
    /** @scenario "A redirect cannot be followed without a policy to judge the hop" */
    it("re-judges the hop and refuses it", async () => {
      seenPaths.length = 0;
      const validated = await validateUrl(`${baseUrl}/redirect-to-metadata`);
      const strict = createSsrfUrlValidator({ blockLocal: true, allowedHosts: [] });

      await expect(
        fetchValidatedDestination(
          validated,
          { method: "POST", body: "{}", revalidate: strict },
          tls,
        ),
      ).rejects.toThrow(/cloud metadata endpoints is not allowed/i);
      expect(seenPaths).toEqual(["/redirect-to-metadata"]);
    });
  });
});
