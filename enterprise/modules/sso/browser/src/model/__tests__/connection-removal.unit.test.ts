// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { SSO_CONNECTION_STATES } from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import { connectionRemovalActFor, connectionRemovalCopyFor } from "../connection-removal.ts";

describe("what removing a connection does", () => {
  describe("given every state a connection can rest in", () => {
    it("names an act for each, so no state leaves the control undecided", () => {
      for (const state of SSO_CONNECTION_STATES) {
        expect(connectionRemovalActFor(state).verb).toMatch(/^(discard|teardown|none)$/);
      }
    });
  });

  describe("given a connection that never carried anybody", () => {
    it("discards it, because nobody's sign-in is affected", () => {
      expect(connectionRemovalActFor("DRAFT")).toEqual({ verb: "discard" });
      expect(connectionRemovalActFor("VERIFIED")).toEqual({ verb: "discard" });
    });
  });

  describe("given a connection people sign in through", () => {
    it("schedules a teardown rather than removing it under them", () => {
      expect(connectionRemovalActFor("ACTIVE")).toEqual({
        verb: "teardown",
        alreadyScheduled: false,
      });
    });

    it("re-asks rather than waiting out a grace protecting nobody", () => {
      expect(connectionRemovalActFor("TEARDOWN_PENDING")).toEqual({
        verb: "teardown",
        alreadyScheduled: true,
      });
    });
  });

  describe("when the reader is told what the press will do", () => {
    it("promises no sign-in change for a discard, and warns for a teardown", () => {
      const discard = connectionRemovalCopyFor({
        act: { verb: "discard" },
        providerName: "Okta",
        scheduledFor: null,
      });
      const teardown = connectionRemovalCopyFor({
        act: { verb: "teardown", alreadyScheduled: false },
        providerName: "Okta",
        scheduledFor: null,
      });

      expect(discard.explanation).toContain("Nothing about anybody's sign-in changes");
      expect(teardown.explanation).toContain("stops new SSO sign-ins");
      expect(teardown.confirm).not.toBe(discard.confirm);
    });

    it("names the date a scheduled removal already has, when there is one", () => {
      const scheduled = connectionRemovalCopyFor({
        act: { verb: "teardown", alreadyScheduled: true },
        providerName: "Okta",
        scheduledFor: "12 March 2026",
      });

      expect(scheduled.explanation).toContain("12 March 2026");
      expect(scheduled.open).toBe("Remove now");
    });
  });
});
