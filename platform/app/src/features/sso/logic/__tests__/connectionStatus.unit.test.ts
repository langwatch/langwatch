import { SSO_CONNECTION_STATES } from "@langwatch/identity";
import { describe, expect, it } from "vitest";
import {
  connectionProtocolName,
  connectionStatusChipFor,
} from "../connectionStatus";

/**
 * What the status chip must never do, rather than what it happens to say.
 *
 * The words themselves are copy and will change; asserting them back would
 * pin nothing. What matters is that every state the aggregate can rest in has
 * an answer, and that none of the answers is the aggregate's own vocabulary.
 */
describe("the connection status chip", () => {
  describe("given every state a connection can rest in", () => {
    /** @scenario "Every state a connection can be in has customer words" */
    it("answers each one in words that are not the state's own name", () => {
      for (const state of SSO_CONNECTION_STATES) {
        const chip = connectionStatusChipFor({ state });

        expect(chip.label.length).toBeGreaterThan(0);
        expect(chip.title.length).toBeGreaterThan(0);
        expect(chip.label).not.toBe(state);
        // The aggregate's vocabulary is SHOUTED_WITH_UNDERSCORES. Nothing
        // shaped like that may reach a reader.
        expect(chip.label).not.toMatch(/^[A-Z_]+$/);
        expect(chip.label).not.toContain("_");
      }
    });
  });

  describe("when the connection is on", () => {
    it("says so as a settled state rather than a warning", () => {
      const carrying = connectionStatusChipFor({ state: "ACTIVE" });

      expect(carrying.tone).toBe("good");
      // The reader has nothing left to do, so the chip must not imply they
      // do: an ACTIVE connection IS the routing decision.
      expect(carrying.shimmer).toBeUndefined();
    });
  });

  describe("when the connection is waiting on the reader", () => {
    it("marks the one state they can act on and no other", () => {
      expect(connectionStatusChipFor({ state: "VERIFIED" }).shimmer).toBe(true);
      expect(connectionStatusChipFor({ state: "SUSPENDED" }).shimmer).toBe(
        undefined,
      );
    });
  });
});

describe("naming a connection by its protocol", () => {
  it("tells the two protocols apart, in the names their administrators know", () => {
    expect(connectionProtocolName("saml")).not.toBe(
      connectionProtocolName("oidc"),
    );
    expect(connectionProtocolName("saml")).toContain("SAML");
    expect(connectionProtocolName("oidc")).toContain("OpenID Connect");
  });
});
