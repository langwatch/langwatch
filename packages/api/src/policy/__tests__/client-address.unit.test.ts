import { describe, expect, it } from "vitest";

import { ClientAddress } from "../client-address.ts";

describe("ClientAddress behind a trusted proxy", () => {
  /** @scenario "A trusted proxy resolves distinct forwarded client addresses" */
  /** @scenario "Auth throttles distinguish callers behind a trusted ingress" */
  it("keeps two callers sharing the same proxy peer apart", () => {
    const addresses = ClientAddress.fromTrustedProxies({ addresses: ["10.0.0.0/8"] });
    const through = (forwardedFor: string) =>
      addresses.of({
        header: (name) => (name === "x-forwarded-for" ? forwardedFor : undefined),
        socketAddress: "10.0.0.1",
      });

    expect(through("198.51.100.7, 10.0.0.2")).toBe("198.51.100.7");
    expect(through("203.0.113.9, 10.0.0.2")).toBe("203.0.113.9");
  });
});

describe("ClientAddress behind a trusted proxy chain", () => {
  /** @scenario A trusted proxy's chain resolves to the rightmost hop it did not write */
  it("resolves the rightmost hop no trusted proxy wrote, past a client-supplied one", () => {
    const addresses = ClientAddress.fromTrustedProxies({ addresses: ["10.0.0.0/8"] });

    const resolved = addresses.of({
      header: (name) =>
        name === "x-forwarded-for" ? "203.0.113.66, 198.51.100.7, 10.0.0.2" : undefined,
      socketAddress: "10.0.0.1",
    });

    expect(resolved).toBe("198.51.100.7");
  });
});

describe("ClientAddress with no declared proxies", () => {
  const addresses = ClientAddress.classifyByAddress();
  const from = ({
    socketAddress,
    forwardedFor,
  }: {
    socketAddress: string;
    forwardedFor?: string;
  }) =>
    addresses.of({
      header: (name) => (name === "x-forwarded-for" ? forwardedFor : undefined),
      socketAddress,
    });

  /** @scenario "A caller on the public internet cannot choose its own throttle bucket" */
  it("counts the address a public caller connected from, whatever it claims", () => {
    expect(from({ socketAddress: "198.51.100.7", forwardedFor: "203.0.113.1" })).toBe(
      "198.51.100.7",
    );
    expect(from({ socketAddress: "198.51.100.7", forwardedFor: "203.0.113.2" })).toBe(
      "198.51.100.7",
    );
  });

  /** @scenario "An in-cluster ingress does not collapse every visitor into one bucket" */
  it("reads the chain through a private ingress, so visitors stay distinct", () => {
    expect(from({ socketAddress: "10.0.0.9", forwardedFor: "198.51.100.7" })).toBe("198.51.100.7");
    expect(from({ socketAddress: "10.0.0.9", forwardedFor: "203.0.113.9" })).toBe("203.0.113.9");
  });
});
