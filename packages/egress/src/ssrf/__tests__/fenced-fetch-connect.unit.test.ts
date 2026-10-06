import dns from "node:dns";
import http from "node:http";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { fetchValidatedDestination } from "../fenced-fetch.ts";
import { createSsrfUrlValidator, type SsrfValidationResult } from "../url-validator.ts";

/**
 * Spec: packages/egress/specs/egress-address-policy.feature
 */

const tls = { rejectUnauthorized: true };
const revalidate = createSsrfUrlValidator({ blockLocal: false, allowedHosts: [] });

function listen(handler: http.RequestListener): Promise<http.Server> {
  const server = http.createServer(handler);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function portOf(server: http.Server): number {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server is not listening");
  return address.port;
}

function admitted({ hostname, port, path }: { hostname: string; port: number; path: string }) {
  const result: SsrfValidationResult = {
    type: "resolved",
    originalUrl: `http://${hostname}:${port}${path}`,
    hostname,
    port,
    protocol: "http:",
    path,
    resolvedIp: hostname,
  };
  return result;
}

function echoHeaders(req: http.IncomingMessage, res: http.ServerResponse) {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ authorization: req.headers.authorization, cookie: req.headers.cookie }));
}

let origin: http.Server;
let other: http.Server;
let originHits = 0;

beforeAll(async () => {
  other = await listen(echoHeaders);
  origin = await listen((req, res) => {
    originHits += 1;
    if (req.url === "/echo") return echoHeaders(req, res);
    const location =
      req.url === "/elsewhere" ? `http://127.0.0.1:${portOf(other)}/landed` : "/echo";
    res.writeHead(302, { location }).end();
  });
});

afterAll(() => {
  for (const server of [origin, other]) {
    server.closeAllConnections();
    server.close();
  }
});

afterEach(() => vi.restoreAllMocks());

const credentials = { authorization: "Bearer caller-token", cookie: "session=1" };

describe("the pinned fetch", () => {
  describe("given a redirect", () => {
    /** @scenario "A redirect to another origin does not carry credentials" */
    it("drops credentials when the next hop is another origin", async () => {
      const validated = admitted({
        hostname: "127.0.0.1",
        port: portOf(origin),
        path: "/elsewhere",
      });
      const response = await fetchValidatedDestination(
        validated,
        { headers: credentials, revalidate },
        tls,
      );
      await expect(response.json()).resolves.toEqual({});
    });

    /** @scenario "A redirect to another origin does not carry credentials" */
    it("keeps credentials when the next hop is the same origin", async () => {
      const validated = admitted({ hostname: "127.0.0.1", port: portOf(origin), path: "/same" });
      const response = await fetchValidatedDestination(
        validated,
        { headers: credentials, revalidate },
        tls,
      );
      await expect(response.json()).resolves.toEqual(credentials);
    });
  });

  describe("given a destination admitted without a resolved address", () => {
    function unresolved(port: number): SsrfValidationResult {
      return {
        type: "unresolved",
        reason: "dns-failed",
        originalUrl: `http://service.example.test:${port}/echo`,
        hostname: "service.example.test",
        port,
        protocol: "http:",
        path: "/echo",
      };
    }

    function lookupGives(address: string) {
      vi.spyOn(dns, "lookup").mockImplementation(((
        _hostname: string,
        _options: unknown,
        callback: (err: Error | null, addresses: dns.LookupAddress[]) => void,
      ) => callback(null, [{ address, family: 4 }])) as never);
    }

    /** @scenario "A destination the validator could not resolve is checked when it connects" */
    it("fails without connecting when the name resolves to a metadata address", async () => {
      lookupGives("169.254.169.254");
      originHits = 0;
      await expect(
        fetchValidatedDestination(unresolved(portOf(origin)), undefined, tls),
      ).rejects.toThrow(/metadata/i);
      expect(originHits).toBe(0);
    });

    /** @scenario "A destination the validator could not resolve is checked when it connects" */
    it("sends the request when the name resolves to an ordinary address", async () => {
      lookupGives("127.0.0.1");
      const response = await fetchValidatedDestination(unresolved(portOf(origin)), undefined, tls);
      expect(response.status).toBe(200);
      await response.body?.cancel();
    });
  });
});
