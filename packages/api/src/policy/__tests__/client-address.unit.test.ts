import { describe, expect, it } from "vitest";

import { ClientAddress } from "../client-address.ts";

describe("ClientAddress behind a trusted proxy", () => {
  /** @scenario "A trusted proxy resolves distinct forwarded client addresses" */
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
