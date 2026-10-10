import { CONNECTION_RENAMED_EVENT_TYPE } from "@langwatch/identity";
import { describe, expect, it } from "vitest";
import { ssoConnectionHistoryCopy } from "../sso-connection-history-copy";

/**
 * The line a rename leaves on the connection's own history.
 *
 * The history is the only place an administrator can see that a name changed
 * at all — the card shows the current one and says nothing about what it was
 * — so a rename with no line would be a change that happened invisibly.
 */
describe("the history line for a rename", () => {
  describe("given a connection that was renamed", () => {
    /** @scenario "The rename is on the connection's own history" */
    it("says what it was renamed to", () => {
      const summary = ssoConnectionHistoryCopy({
        type: CONNECTION_RENAMED_EVENT_TYPE,
        domain: null,
        method: null,
        route: null,
        policy: null,
        note: null,
        name: "Acme Okta",
      });

      expect(summary).toContain("Acme Okta");
      expect(summary).toMatch(/renamed/i);
      // Never the fallback: a fact with no words is a gap in the sequence.
      expect(summary).not.toMatch(/no words for/i);
    });
  });
});
