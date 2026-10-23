import http from "node:http";
import net from "node:net";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { fetchValidatedDestination } from "../fenced-fetch.ts";
import type { SsrfUrlValidator, SsrfValidationResult } from "../url-validator.ts";

/**
 * Spec: packages/egress/specs/egress-address-policy.feature
 */

const tls = { rejectUnauthorized: true };

/** A documentation address nothing answers on: a hop pinned here never arrives. */
const UNREACHABLE_IP = "192.0.2.1";

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("server is not listening");
      resolve(address.port);
    }),
  );
}

function admitted({
  hostname,
  port,
  path,
  resolvedIp,
}: {
  hostname: string;
  port: number;
  path: string;
  resolvedIp: string;
}): SsrfValidationResult {
  return {
    type: "resolved",
    originalUrl: `http://${hostname}:${port}${path}`,
    hostname,
    port,
    protocol: "http:",
    path,
    resolvedIp,
  };
}

let origin: http.Server;
let proxy: http.Server;
let originPort = 0;
let proxyUrl = "";
/** The authorities the proxy was asked to reach, in order. */
let tunnelled: string[] = [];

beforeAll(async () => {
  origin = http.createServer((req, res) => {
    if (req.url === "/refused") {
      res.writeHead(302, { location: "http://internal.example.test/" }).end();
      return;
    }
    res.end("from origin");
  });
  originPort = await listen(origin);

  // Every request lands on the origin, whatever it names: only the proxy knows the way.
  // Plain http is forwarded by absolute URL; https asks for a CONNECT tunnel.
  proxy = http.createServer((req, res) => {
    const target = new URL(req.url ?? "");
    tunnelled.push(target.host);
    const upstream = http.request(
      { host: "127.0.0.1", port: originPort, path: target.pathname, headers: req.headers },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(res);
      },
    );
    upstream.on("error", () => res.destroy());
    req.pipe(upstream);
  });
  proxy.on("connect", (req: http.IncomingMessage, client: net.Socket, head: Buffer) => {
    tunnelled.push(req.url ?? "");
    const upstream = net.connect(originPort, "127.0.0.1", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
  });
  proxyUrl = `http://127.0.0.1:${await listen(proxy)}`;
});

beforeEach(() => {
  tunnelled = [];
});

afterAll(() => {
  for (const server of [origin, proxy]) {
    server.closeAllConnections();
    server.close();
  }
});

describe("the pinned fetch with an outbound proxy", () => {
  describe("given a destination the proxy applies to", () => {
    /** @scenario "An admitted destination leaves through the configured outbound proxy" */
    it("sends the request through the proxy, by name, not to the judged address", async () => {
      const validated = admitted({
        hostname: "idp.example.test",
        port: originPort,
        path: "/",
        resolvedIp: UNREACHABLE_IP,
      });

      const response = await fetchValidatedDestination(
        validated,
        { proxy: { httpsProxy: proxyUrl } },
        tls,
      );

      await expect(response.text()).resolves.toBe("from origin");
      expect(tunnelled).toEqual([`idp.example.test:${originPort}`]);
    });

    /** @scenario "An admitted destination leaves through the configured outbound proxy" */
    it("asks the proxy for a tunnel to the named host when the destination is https", async () => {
      const validated: SsrfValidationResult = {
        ...admitted({
          hostname: "idp.example.test",
          port: originPort,
          path: "/",
          resolvedIp: UNREACHABLE_IP,
        }),
        originalUrl: `https://idp.example.test:${originPort}/`,
        protocol: "https:",
      };

      // The origin speaks plain http, so the handshake fails: the CONNECT is the point.
      await expect(
        fetchValidatedDestination(validated, { proxy: { httpsProxy: proxyUrl } }, tls),
      ).rejects.toThrow(/idp\.example\.test/);
      expect(tunnelled).toEqual([`idp.example.test:${originPort}`]);
    });
  });

  describe("given a destination NO_PROXY names", () => {
    /** @scenario "A destination the proxy exclusions name is reached directly" */
    it("connects to the judged address without the proxy", async () => {
      const validated = admitted({
        hostname: "127.0.0.1",
        port: originPort,
        path: "/",
        resolvedIp: "127.0.0.1",
      });

      const response = await fetchValidatedDestination(
        validated,
        { proxy: { httpsProxy: proxyUrl, noProxy: "localhost,127.0.0.1" } },
        tls,
      );

      await expect(response.text()).resolves.toBe("from origin");
      expect(tunnelled).toEqual([]);
    });
  });

  describe("given a proxy setting that is not a URL", () => {
    /** @scenario "A malformed proxy setting fails as a connection error" */
    it("fails as a connection error naming the destination", async () => {
      const validated = admitted({
        hostname: "idp.example.test",
        port: originPort,
        path: "/",
        resolvedIp: UNREACHABLE_IP,
      });

      await expect(
        fetchValidatedDestination(validated, { proxy: { httpsProxy: "proxy.corp:3128" } }, tls),
      ).rejects.toThrow(new RegExp(`Connection failed to idp.example.test:${originPort}`));
      expect(tunnelled).toEqual([]);
    });
  });

  describe("given a redirect to a destination the policy refuses", () => {
    /** @scenario "A redirect is judged again before it travels through the proxy" */
    it("refuses the next hop without asking the proxy for it", async () => {
      const refuse: SsrfUrlValidator = async () => {
        throw new Error("refused by the address policy");
      };
      const validated = admitted({
        hostname: "idp.example.test",
        port: originPort,
        path: "/refused",
        resolvedIp: UNREACHABLE_IP,
      });

      await expect(
        fetchValidatedDestination(
          validated,
          { proxy: { httpsProxy: proxyUrl }, revalidate: refuse },
          tls,
        ),
      ).rejects.toThrow(/refused by the address policy/);
      expect(tunnelled).toEqual([`idp.example.test:${originPort}`]);
    });
  });
});
