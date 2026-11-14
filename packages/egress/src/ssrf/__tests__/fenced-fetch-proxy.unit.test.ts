import http from "node:http";
import net from "node:net";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  fetchValidatedDestination,
  OutboundProxyMisconfiguredError,
  OutboundProxyUnreachableError,
} from "../fenced-fetch.ts";
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

/** An https hop to a named host, judged at an address nothing answers on. */
function httpsHop(): SsrfValidationResult {
  return {
    ...admitted({
      hostname: "idp.example.test",
      port: originPort,
      path: "/",
      resolvedIp: UNREACHABLE_IP,
    }),
    originalUrl: `https://idp.example.test:${originPort}/`,
    protocol: "https:",
  };
}

/** A loopback port that was free a moment ago, so a connection to it is refused. */
async function portNothingListensOn(): Promise<number> {
  const probe = http.createServer();
  const port = await listen(probe);
  await new Promise((resolve) => probe.close(resolve));
  return port;
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

    it("blames the destination, not the proxy, when the tunnelled handshake fails", async () => {
      const failure = await fetchValidatedDestination(
        httpsHop(),
        { proxy: { httpsProxy: proxyUrl } },
        tls,
      ).catch((error: unknown) => error);

      expect(failure).not.toBeInstanceOf(OutboundProxyUnreachableError);
    });
  });

  describe("given HTTP_PROXY and HTTPS_PROXY naming different proxies", () => {
    /** @scenario "The proxy is chosen by the destination's scheme" */
    it("sends an http destination through HTTP_PROXY", async () => {
      const closedPort = await portNothingListensOn();
      const validated = admitted({
        hostname: "idp.example.test",
        port: originPort,
        path: "/",
        resolvedIp: UNREACHABLE_IP,
      });

      const response = await fetchValidatedDestination(
        validated,
        { proxy: { httpProxy: proxyUrl, httpsProxy: `http://127.0.0.1:${closedPort}` } },
        tls,
      );

      await expect(response.text()).resolves.toBe("from origin");
      expect(tunnelled).toEqual([`idp.example.test:${originPort}`]);
    });

    /** @scenario "The proxy is chosen by the destination's scheme" */
    it("sends an https destination through HTTPS_PROXY", async () => {
      const closedPort = await portNothingListensOn();

      const failure = await fetchValidatedDestination(
        httpsHop(),
        { proxy: { httpProxy: proxyUrl, httpsProxy: `http://127.0.0.1:${closedPort}` } },
        tls,
      ).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(OutboundProxyUnreachableError);
      expect((failure as Error).message).toContain(`127.0.0.1:${closedPort}`);
      expect(tunnelled).toEqual([]);
    });

    /** @scenario "The proxy is chosen by the destination's scheme" */
    it("sends either scheme through the one proxy that is set", async () => {
      const response = await fetchValidatedDestination(
        admitted({
          hostname: "idp.example.test",
          port: originPort,
          path: "/",
          resolvedIp: UNREACHABLE_IP,
        }),
        { proxy: { httpsProxy: proxyUrl } },
        tls,
      );
      await expect(response.text()).resolves.toBe("from origin");

      await fetchValidatedDestination(httpsHop(), { proxy: { httpProxy: proxyUrl } }, tls).catch(
        () => undefined,
      );
      expect(tunnelled).toEqual([
        `idp.example.test:${originPort}`,
        `idp.example.test:${originPort}`,
      ]);
    });
  });

  describe("given a proxy that cannot be reached", () => {
    /** @scenario "A proxy that cannot be reached is named as the failure, not the destination" */
    it("fails naming the proxy's host, without its credentials", async () => {
      const closedPort = await portNothingListensOn();

      const failure = await fetchValidatedDestination(
        httpsHop(),
        { proxy: { httpsProxy: `http://user:secret@127.0.0.1:${closedPort}` } },
        tls,
      ).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(OutboundProxyUnreachableError);
      expect((failure as Error).message).toContain(`127.0.0.1:${closedPort}`);
      expect((failure as Error).message).not.toMatch(/secret|idp\.example\.test/);
    });
  });

  describe("given a proxy whose hostname does not resolve", () => {
    /** @scenario "A proxy whose hostname does not resolve is named as the failure" */
    it("fails naming the proxy's host, not the destination", async () => {
      const failure = await fetchValidatedDestination(
        httpsHop(),
        { proxy: { httpsProxy: "http://proxy.invalid:3128" } },
        tls,
      ).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(OutboundProxyUnreachableError);
      expect((failure as Error).message).toContain("proxy.invalid:3128");
      expect((failure as Error).message).not.toMatch(/idp\.example\.test/);
    });
  });

  describe("given a proxy that refuses the tunnel", () => {
    /** @scenario "A proxy that refuses the tunnel is named as the failure" */
    it("fails naming the proxy, not the destination", async () => {
      const refusing = http.createServer();
      refusing.on("connect", (_req: http.IncomingMessage, client: net.Socket) => {
        client.end("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n");
      });
      const port = await listen(refusing);
      try {
        const failure = await fetchValidatedDestination(
          httpsHop(),
          { proxy: { httpsProxy: `http://127.0.0.1:${port}` } },
          tls,
        ).catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(OutboundProxyUnreachableError);
        expect((failure as Error).message).toContain(`127.0.0.1:${port}`);
      } finally {
        refusing.closeAllConnections();
        refusing.close();
      }
    });
  });

  describe("given a proxy that never answers a tunnel request", () => {
    /** @scenario "The headers timeout also bounds the proxy's answer to a tunnel request" */
    it("fails once the headers timeout passes", async () => {
      const stalled = http.createServer();
      stalled.on("connect", () => undefined);
      const port = await listen(stalled);
      try {
        const started = Date.now();
        await expect(
          fetchValidatedDestination(
            httpsHop(),
            { proxy: { httpsProxy: `http://127.0.0.1:${port}` }, headersTimeoutMs: 200 },
            tls,
          ),
        ).rejects.toThrow(/Headers Timeout/);
        expect(Date.now() - started).toBeLessThan(5_000);
      } finally {
        stalled.closeAllConnections();
        stalled.close();
      }
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

  describe("given a hop the caller routes around the proxy", () => {
    /** @scenario "A hop the caller routes around the proxy is reached directly" */
    it("connects to the judged address without the proxy", async () => {
      const validated = admitted({
        hostname: "idp.example.test",
        port: originPort,
        path: "/",
        resolvedIp: "127.0.0.1",
      });
      const asked: string[] = [];

      const response = await fetchValidatedDestination(
        validated,
        {
          proxy: { httpsProxy: proxyUrl },
          bypassProxy: (hop) => {
            asked.push(hop.hostname);
            return true;
          },
        },
        tls,
      );

      await expect(response.text()).resolves.toBe("from origin");
      expect(tunnelled).toEqual([]);
      expect(asked).toEqual(["idp.example.test"]);
    });

    it("still sends a hop it does not route around through the proxy", async () => {
      const validated = admitted({
        hostname: "idp.example.test",
        port: originPort,
        path: "/",
        resolvedIp: UNREACHABLE_IP,
      });

      const response = await fetchValidatedDestination(
        validated,
        { proxy: { httpsProxy: proxyUrl }, bypassProxy: () => false },
        tls,
      );

      await expect(response.text()).resolves.toBe("from origin");
      expect(tunnelled).toEqual([`idp.example.test:${originPort}`]);
    });
  });

  describe("given a proxy setting that is not a URL", () => {
    /** @scenario "A malformed proxy setting fails as a proxy configuration error" */
    it("fails naming the proxy setting, not the destination or the setting's value", async () => {
      const validated = admitted({
        hostname: "idp.example.test",
        port: originPort,
        path: "/",
        resolvedIp: UNREACHABLE_IP,
      });

      const failure = await fetchValidatedDestination(
        validated,
        { proxy: { httpsProxy: "user:secret@proxy.corp:3128" } },
        tls,
      ).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(OutboundProxyMisconfiguredError);
      expect((failure as Error).message).toMatch(/HTTPS_PROXY/);
      expect((failure as Error).message).not.toMatch(/idp\.example\.test|secret|proxy\.corp/);
      expect((failure as Error).cause).toBeUndefined();
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
