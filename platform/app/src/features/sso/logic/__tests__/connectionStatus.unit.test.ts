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
 * an answer, that none of the answers is the aggregate's own vocabulary, and
 * that "on" and "actually carrying sign-ins" stay two different chips.
 */
describe("the connection status chip", () => {
  describe("given every state a connection can rest in", () => {
    /** @scenario "Every state a connection can be in has customer words" */
    it("answers each one in words that are not the state's own name", () => {
      for (const state of SSO_CONNECTION_STATES) {
        for (const routingSwitchedOn of [true, false]) {
          const chip = connectionStatusChipFor({ state, routingSwitchedOn });

          expect(chip.label.length).toBeGreaterThan(0);
          expect(chip.title.length).toBeGreaterThan(0);
          expect(chip.label).not.toBe(state);
          // The aggregate's vocabulary is SHOUTED_WITH_UNDERSCORES. Nothing
          // shaped like that may reach a reader.
          expect(chip.label).not.toMatch(/^[A-Z_]+$/);
          expect(chip.label).not.toContain("_");
        }
      }
    });
  });

  describe("when the connection is on but sign-ins have not moved to it", () => {
    it("says something different from a connection that is carrying them", () => {
      const carrying = connectionStatusChipFor({
        state: "ACTIVE",
        routingSwitchedOn: true,
      });
      const notYet = connectionStatusChipFor({
        state: "ACTIVE",
        routingSwitchedOn: false,
      });

      expect(notYet.label).not.toBe(carrying.label);
      expect(carrying.tone).toBe("good");
      // Not good: nothing is being routed yet, and a green chip would tell
      // somebody their rollout finished.
      expect(notYet.tone).not.toBe("good");
    });
  });

  describe("when a state is nothing to do with routing", () => {
    it("answers the same either way", () => {
      expect(
        connectionStatusChipFor({
          state: "SUSPENDED",
          routingSwitchedOn: true,
        }),
      ).toEqual(
        connectionStatusChipFor({
          state: "SUSPENDED",
          routingSwitchedOn: false,
        }),
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
