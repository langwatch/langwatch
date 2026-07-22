import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DispatchError } from "@langwatch/dispatch-error";
import { createSSRFValidator } from "~/utils/ssrfProtection";
import { sendHttpDestination } from "../httpDestination";

/**
 * Executed redirect-refusal regression (ADR-040 §4): the strict-validator
 * path must refuse a 3xx-with-Location outright — following it would
 * re-validate through the weaker default policy. Observed against a REAL
 * local server through the REAL `fetchWithResolvedIp`, no mocks — per the
 * repo's "regression test must execute the code path" rule.
 *
 * The validator here is deliberately permissive (`blockLocal: false`) so the
 * test can reach 127.0.0.1; redirect refusal is orthogonal to the private-IP
 * policy, which `sendWebhook.unit.test.ts` covers.
 */
const validateUrl = createSSRFValidator({
  blockLocal: false,
  allowedHosts: [],
});

let server: Server;
let baseUrl: string;
const seenPaths: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    seenPaths.push(req.url ?? "");
    if (req.url === "/redirect-to-metadata") {
      res.writeHead(302, {
        Location: "http://169.254.169.254/latest/meta-data/",
      });
      res.end();
    } else if (req.url === "/bare-3xx") {
      res.writeHead(304);
      res.end();
    } else {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
    }
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", resolve),
  );
  const address = server.address();
  if (typeof address === "string" || address === null) {
    throw new Error("expected an AddressInfo");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

const send = (path: string) =>
  sendHttpDestination({
    url: `${baseUrl}${path}`,
    body: "{}",
    contextLabel: "redirect test",
    validateUrl,
  });

describe("sendHttpDestination with a strict validator", () => {
  describe("when the endpoint answers a redirect toward cloud metadata", () => {
    it("refuses the redirect terminally without following it", async () => {
      seenPaths.length = 0;
      let caught: unknown;
      try {
        await send("/redirect-to-metadata");
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(DispatchError);
      expect((caught as DispatchError).retryable).toBe(false);
      expect((caught as DispatchError).message).toMatch(/redirect/i);
      // Exactly one request reached the local server; the metadata Location
      // was never contacted (a hop would have re-entered the fetch).
      expect(seenPaths).toEqual(["/redirect-to-metadata"]);
    });
  });

  describe("when the endpoint answers a 3xx without a Location", () => {
    it("returns the status for the caller to classify", async () => {
      await expect(send("/bare-3xx")).resolves.toMatchObject({ status: 304 });
    });
  });

  describe("when the endpoint answers 2xx", () => {
    it("delivers normally through the strict path", async () => {
      await expect(send("/ok")).resolves.toMatchObject({ status: 200, body: "ok" });
    });
  });
});
