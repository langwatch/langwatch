import type { Context } from "hono";
import { describe, expect, it } from "vitest";
import { nearestHopIp } from "../client-ip";

/** Just enough Context for the header reads under test. */
function contextWith(headers: Record<string, string>): Context {
  return {
    req: { header: (name: string) => headers[name.toLowerCase()] },
  } as unknown as Context;
}

describe("resolving the caller's address", () => {
  describe("given a forwarded-for chain", () => {
    /** @scenario "the client cannot pick its own IP" */
    it("reads the hop nearest us, not the one the client wrote", () => {
      // Each proxy appends, so only the last entry was written by a machine we
      // control. Trusting the first would let a forged header pick its own
      // rate-limit bucket.
      const ip = nearestHopIp(
        contextWith({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 203.0.113.7" }),
      );

      expect(ip).toBe("203.0.113.7");
    });

    it("trims the whitespace proxies insert after each comma", () => {
      expect(
        nearestHopIp(
          contextWith({ "x-forwarded-for": "1.1.1.1,  203.0.113.7 " }),
        ),
      ).toBe("203.0.113.7");
    });

    it("handles a single-hop chain", () => {
      expect(
        nearestHopIp(contextWith({ "x-forwarded-for": "203.0.113.7" })),
      ).toBe("203.0.113.7");
    });
  });

  describe("when there is no forwarded-for header", () => {
    it("falls back to x-real-ip", () => {
      expect(nearestHopIp(contextWith({ "x-real-ip": "203.0.113.9" }))).toBe(
        "203.0.113.9",
      );
    });
  });

  describe("when no header carries a usable address", () => {
    it("returns null rather than a shared placeholder", () => {
      // A literal "unknown" bucket would meter every such caller against every
      // other one; null lets each caller decide what absence means.
      expect(nearestHopIp(contextWith({}))).toBeNull();
      expect(nearestHopIp(contextWith({ "x-forwarded-for": "" }))).toBeNull();
      expect(nearestHopIp(contextWith({ "x-forwarded-for": "  " }))).toBeNull();
    });
  });
});
