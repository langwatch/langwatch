import { IncomingMessage } from "node:http";
import { Socket } from "node:net";

import { describe, expect, it } from "vitest";

import { ClientAddress } from "../client-address.ts";

/** Cloudflare-published ranges stand in for the deployment's declared edge. */
const CLOUDFLARE = ["173.245.48.0/20", "104.16.0.0/13", "2400:cb00::/32"];
const EDGE = "173.245.48.10";
const NODE = "10.0.3.17";

function resolve({
  addresses,
  trustCloudflare,
  socketAddress,
  headers,
}: {
  addresses?: readonly string[];
  trustCloudflare?: boolean;
  socketAddress: string;
  headers: Record<string, string>;
}): string | undefined {
  return ClientAddress.fromTrustedProxies({
    ...(addresses ? { addresses } : {}),
    ...(trustCloudflare ? { trustCloudflare } : {}),
  }).of({ header: (name) => headers[name], socketAddress });
}

describe("ClientAddress behind a trusted proxy", () => {
  /** @scenario "A trusted proxy resolves distinct forwarded client addresses" */
  /** @scenario "Auth throttles distinguish callers behind a trusted ingress" */
  it("keeps two callers sharing the same proxy peer apart", () => {
    const through = (forwardedFor: string) =>
      resolve({
        addresses: ["10.0.0.0/8"],
        socketAddress: "10.0.0.1",
        headers: { "x-forwarded-for": forwardedFor },
      });

    expect(through("198.51.100.7, 10.0.0.2")).toBe("198.51.100.7");
    expect(through("203.0.113.9, 10.0.0.2")).toBe("203.0.113.9");
  });

  /** @scenario A trusted proxy's chain resolves to the rightmost hop it did not write */
  it("resolves the rightmost hop no trusted proxy wrote, past a client-supplied one", () => {
    expect(
      resolve({
        addresses: ["10.0.0.0/8"],
        socketAddress: "10.0.0.1",
        headers: { "x-forwarded-for": "203.0.113.66, 198.51.100.7, 10.0.0.2" },
      }),
    ).toBe("198.51.100.7");
  });

  /** @scenario "An in-cluster ingress declared as a trusted proxy does not collapse every visitor into one bucket" */
  it("reads the chain through a declared private ingress, so visitors stay distinct", () => {
    const from = (forwardedFor: string) =>
      resolve({
        addresses: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"],
        socketAddress: "10.0.0.9",
        headers: { "x-forwarded-for": forwardedFor },
      });

    expect(from("198.51.100.7")).toBe("198.51.100.7");
    expect(from("203.0.113.9")).toBe("203.0.113.9");
  });

  it("falls back to the peer when the nearest hop is one no parser reads", () => {
    expect(
      resolve({
        addresses: ["10.0.0.0/8"],
        socketAddress: "10.0.0.1",
        headers: { "x-forwarded-for": "203.0.113.66, 198.51.100.7:51234" },
      }),
    ).toBe("10.0.0.1");
  });

  /** @scenario "Vendor headers other than the forwarded chain are never read" */
  it("reads no vendor header besides the forwarded chain", () => {
    expect(
      resolve({
        addresses: ["10.0.0.0/8"],
        socketAddress: "10.0.0.1",
        headers: { "x-real-ip": "203.0.113.5", "true-client-ip": "203.0.113.6" },
      }),
    ).toBe("10.0.0.1");
  });
});

describe("ClientAddress with Cloudflare in front", () => {
  /** @scenario "A trusted Cloudflare peer with the flag on names the caller" */
  it("uses CF-Connecting-IP from a declared Cloudflare edge", () => {
    expect(
      resolve({
        addresses: CLOUDFLARE,
        trustCloudflare: true,
        socketAddress: EDGE,
        headers: { "cf-connecting-ip": "198.51.100.7", "x-forwarded-for": "203.0.113.1" },
      }),
    ).toBe("198.51.100.7");
  });

  /** @scenario "A direct caller behind a source-rewriting load balancer cannot forge its address" */
  it("answers with the node address when a private peer outside the set forges both headers", () => {
    expect(
      resolve({
        addresses: CLOUDFLARE,
        trustCloudflare: true,
        socketAddress: NODE,
        headers: { "cf-connecting-ip": "198.51.100.7", "x-forwarded-for": "198.51.100.8" },
      }),
    ).toBe(NODE);
  });

  /** @scenario "The flag on does not honour CF-Connecting-IP from a peer outside the trusted set" */
  it("ignores CF-Connecting-IP from a public peer outside the set", () => {
    expect(
      resolve({
        addresses: CLOUDFLARE,
        trustCloudflare: true,
        socketAddress: "203.0.113.200",
        headers: { "cf-connecting-ip": "198.51.100.7" },
      }),
    ).toBe("203.0.113.200");
  });

  /** @scenario "The flag off ignores CF-Connecting-IP even from a trusted peer" */
  it("ignores CF-Connecting-IP from a trusted edge while the flag is off", () => {
    expect(
      resolve({
        addresses: CLOUDFLARE,
        socketAddress: EDGE,
        headers: { "cf-connecting-ip": "198.51.100.7" },
      }),
    ).toBe(EDGE);
  });

  /** @scenario "A list or junk in CF-Connecting-IP falls through to the forwarded chain" */
  it.each(["198.51.100.7, 198.51.100.8", "not-an-address"])(
    "falls through to the forwarded chain past CF-Connecting-IP %j",
    (cloudflareHeader) => {
      expect(
        resolve({
          addresses: CLOUDFLARE,
          trustCloudflare: true,
          socketAddress: EDGE,
          headers: { "cf-connecting-ip": cloudflareHeader, "x-forwarded-for": "203.0.113.9" },
        }),
      ).toBe("203.0.113.9");
    },
  );
});

describe("ClientAddress with no declared proxies", () => {
  /** @scenario "A caller on the public internet cannot choose its own throttle bucket" */
  it("counts the address a public caller connected from, whatever it claims", () => {
    const from = (forwardedFor: string) =>
      resolve({ socketAddress: "198.51.100.7", headers: { "x-forwarded-for": forwardedFor } });

    expect(from("203.0.113.1")).toBe("198.51.100.7");
    expect(from("203.0.113.2")).toBe("198.51.100.7");
  });

  /** @scenario "A private peer is not trusted by default" */
  it("reads no header from a private peer", () => {
    const headers = {
      "x-forwarded-for": "198.51.100.7",
      "x-real-ip": "198.51.100.8",
      "true-client-ip": "198.51.100.9",
      "cf-connecting-ip": "198.51.100.10",
    };

    expect(resolve({ socketAddress: NODE, headers })).toBe(NODE);
    expect(resolve({ addresses: [], socketAddress: NODE, headers })).toBe(NODE);
  });
});

describe("ClientAddress with an IPv6 trusted range", () => {
  /** @scenario "A peer inside a trusted IPv6 range is a declared hop" */
  it("trusts a peer inside the range and only that peer", () => {
    const from = (socketAddress: string) =>
      resolve({
        addresses: ["2400:cb00::/32"],
        socketAddress,
        headers: { "x-forwarded-for": "2001:db8::7, 2400:cb00:1::1" },
      });

    expect(from("2400:cb00:2::9")).toBe("2001:db8::7");
    expect(from("2a00:1450::1")).toBe("2a00:1450::1");
  });
});

describe("ClientAddress over a raw Node request", () => {
  /** @scenario "A raw door ahead of the router reads the resolved address" */
  it("stamps the resolved address on the incoming message", () => {
    const socket = new Socket();
    Object.defineProperty(socket, "remoteAddress", { value: "::ffff:10.0.3.17" });
    const request = new IncomingMessage(socket);
    request.headers = { "x-forwarded-for": "198.51.100.7", "cf-connecting-ip": "198.51.100.8" };

    ClientAddress.fromTrustedProxies({
      addresses: CLOUDFLARE,
      trustCloudflare: true,
    }).handleIncoming(request);

    expect(ClientAddress.resolvedFor(request)).toBe(NODE);
  });
});

describe("ClientAddress spelling", () => {
  const resolved = (socketAddress: string) =>
    ClientAddress.fromTrustedProxies({}).of({ header: () => void 0, socketAddress });

  /** @scenario "A resolved address has one spelling" */
  it("lower-cases IPv6, unmaps a mapped IPv4 and keeps a mapped-looking IPv6", () => {
    expect(resolved("2001:DB8::1")).toBe("2001:db8::1");
    expect(resolved("::FFFF:203.0.113.7")).toBe("203.0.113.7");
    expect(resolved("::ffff:abcd")).toBe("::ffff:abcd");
  });
});
