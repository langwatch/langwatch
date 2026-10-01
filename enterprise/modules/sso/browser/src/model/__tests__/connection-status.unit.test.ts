// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { SSO_CONNECTION_STATES } from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import { connectionProtocolName, connectionStatusChipFor } from "../connection-status.ts";

/**
 * What the chip must never do, rather than what it happens to say: the words
 * are copy and will change, so asserting them back would pin nothing.
 */
describe("the connection status chip", () => {
  describe("given every state a connection can rest in", () => {
    it("answers each one in words that are not the state's own name", () => {
      for (const state of SSO_CONNECTION_STATES) {
        const chip = connectionStatusChipFor({ state });

        expect(chip.label.length).toBeGreaterThan(0);
        expect(chip.title.length).toBeGreaterThan(0);
        expect(chip.label).not.toBe(state);
        // The aggregate's vocabulary is SHOUTED_WITH_UNDERSCORES; nothing
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
      expect(carrying.shimmer).toBeUndefined();
    });
  });

  describe("when the connection is waiting on the reader", () => {
    it("marks the one state they can act on and no other", () => {
      expect(
        connectionStatusChipFor({ state: "VERIFIED", goLiveBlockedBecause: null }).shimmer,
      ).toBe(true);
      expect(connectionStatusChipFor({ state: "SUSPENDED" }).shimmer).toBeUndefined();
    });
  });

  describe("when the domain is proved but the journey is not finished", () => {
    /** @scenario "A proved domain does not claim to be ready while steps are outstanding" */
    it("says the domain is proved rather than that it is ready to turn on", () => {
      const blocked = connectionStatusChipFor({
        state: "VERIFIED",
        goLiveBlockedBecause:
          "Turning it on needs a sign-in that worked. Finish that step above and this opens up.",
      });

      expect(blocked.label).not.toBe("Ready to turn on");
      expect(blocked.shimmer).toBeUndefined();
      expect(blocked.title).toContain("a sign-in that worked");
    });

    it("still says it is ready once nothing is outstanding", () => {
      expect(connectionStatusChipFor({ state: "VERIFIED", goLiveBlockedBecause: null }).label).toBe(
        "Ready to turn on",
      );
    });

    it("does not promise readiness to a caller that cannot see the steps", () => {
      // `undefined`, not `null`: a surface without the four preconditions
      // falls to the narrower true statement rather than the optimistic one.
      const unknown = connectionStatusChipFor({ state: "VERIFIED" });

      expect(unknown.label).not.toBe("Ready to turn on");
      expect(unknown.shimmer).toBeUndefined();
    });
  });
});

describe("naming a connection by its protocol", () => {
  it("tells the two protocols apart, in the names their administrators know", () => {
    expect(connectionProtocolName("saml")).not.toBe(connectionProtocolName("oidc"));
    expect(connectionProtocolName("saml")).toContain("SAML");
    expect(connectionProtocolName("oidc")).toContain("OpenID Connect");
  });
});
