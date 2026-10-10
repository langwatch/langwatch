/**
 * Langy's rule for when a notification is sent, and the readers of its two tools.
 * @see specs/langy/langy-notifications.feature
 */
import { describe, expect, it } from "vitest";

import {
  isNotificationToolPart,
  LANGY_LONG_TURN_MS,
  LANGY_NOTIFY_TITLE_MAX,
  langyNotificationFor,
  langyTabNotifies,
  offerNotificationsCallId,
  readNotifyCall,
} from "../langy-notifications.ts";

const ALLOWED = { enabled: true, permission: "granted" as const };

describe("langyNotificationFor", () => {
  describe("given Langy notifications are enabled and the browser allows them", () => {
    describe("when the tab is hidden", () => {
      /** @scenario "A long turn that finishes while I am away notifies me from the tab without push" */
      it("notifies that a turn of more than a minute finished", () => {
        expect(
          langyNotificationFor({
            ...ALLOWED,
            away: true,
            event: { kind: "turn_finished", durationMs: LANGY_LONG_TURN_MS + 1 },
            conversationTitle: "Set up tracing",
          }),
        ).toEqual({ title: "Langy finished", body: 'Done with "Set up tracing".' });
      });

      /** @scenario "A short turn that finishes while I am away sends nothing" */
      it("sends nothing for a ten second turn", () => {
        expect(
          langyNotificationFor({
            ...ALLOWED,
            away: true,
            event: { kind: "turn_finished", durationMs: 10_000 },
          }),
        ).toBeNull();
      });
    });

    describe("when the tab is not focused and Langy puts up a card that waits", () => {
      /** @scenario "A decision Langy needs while I am away notifies me" */
      it("notifies that Langy needs a decision", () => {
        expect(
          langyNotificationFor({ ...ALLOWED, away: true, event: { kind: "decision_needed" } }),
        ).toEqual({ title: "Langy needs a decision", body: "Langy is waiting on your answer." });
      });
    });

    describe("when the tab is visible and focused", () => {
      /** @scenario "Nothing is sent while the tab is focused and visible" */
      it("sends nothing, whatever happened", () => {
        for (const event of [
          { kind: "turn_finished" as const, durationMs: LANGY_LONG_TURN_MS * 5 },
          { kind: "decision_needed" as const },
          { kind: "tool" as const, title: "Your project is ready", body: "" },
        ]) {
          expect(langyNotificationFor({ ...ALLOWED, away: false, event })).toBeNull();
        }
      });
    });
  });

  describe("given I declined Langy notifications", () => {
    /** @scenario "Nothing is sent when Langy notifications are not on" */
    it("sends nothing while I am away", () => {
      expect(
        langyNotificationFor({
          enabled: false,
          permission: "granted",
          away: true,
          event: { kind: "turn_finished", durationMs: LANGY_LONG_TURN_MS * 5 },
        }),
      ).toBeNull();
    });
  });

  describe("given the browser blocked notifications", () => {
    it("sends nothing even when they were turned on", () => {
      expect(
        langyNotificationFor({
          enabled: true,
          permission: "denied",
          away: true,
          event: { kind: "decision_needed" },
        }),
      ).toBeNull();
    });
  });
});

describe("the notification tool parts", () => {
  it("reads a notify call the worker let through, cut to size", () => {
    const call = readNotifyCall({
      type: "tool-notify",
      state: "output-available",
      toolCallId: "call-1",
      input: { title: "x".repeat(200), body: "  Tracing and a suite\n are set up. " },
    });

    expect(call?.callId).toBe("call-1");
    expect(call?.title).toHaveLength(LANGY_NOTIFY_TITLE_MAX);
    expect(call?.title.endsWith("…")).toBe(true);
    expect(call?.body).toBe("Tracing and a suite are set up.");
  });

  it("ignores a refused notify call", () => {
    expect(
      readNotifyCall({
        type: "dynamic-tool",
        toolName: "notify",
        state: "output-error",
        toolCallId: "call-2",
        input: { title: "Again", body: "" },
      }),
    ).toBeNull();
  });

  it("finds the offer only once the worker answered it", () => {
    const streaming = { type: "tool-offer_notifications", state: "input-available" };
    const answered = {
      type: "tool-offer_notifications",
      state: "output-available",
      toolCallId: "offer-1",
    };

    expect(offerNotificationsCallId([streaming])).toBeNull();
    expect(offerNotificationsCallId([answered])).toBe("offer-1");
    expect(isNotificationToolPart(answered)).toBe(true);
    expect(isNotificationToolPart({ type: "tool-say" })).toBe(false);
  });
});

describe("langyTabNotifies", () => {
  /** @scenario "A device with a live push subscription leaves notifying to the server" */
  it("keeps the tab quiet where this browser holds a push subscription", () => {
    expect(langyTabNotifies({ choice: "enabled", pushDevice: "subscribed" })).toBe(false);
  });

  /** @scenario "A browser not yet checked for push leaves notifying to the server" */
  it("keeps the tab quiet before this browser's push standing is known", () => {
    expect(langyTabNotifies({ choice: "enabled", pushDevice: "unknown" })).toBe(false);
  });

  it("notifies from the tab only where this browser cannot hold a push subscription", () => {
    expect(langyTabNotifies({ choice: "enabled", pushDevice: "unavailable" })).toBe(true);
  });

  it("never notifies for a person who did not turn notifications on", () => {
    expect(langyTabNotifies({ choice: "declined", pushDevice: "unavailable" })).toBe(false);
    expect(langyTabNotifies({ choice: null, pushDevice: "unavailable" })).toBe(false);
    expect(langyTabNotifies({ choice: "declined", pushDevice: "unsubscribed" })).toBe(false);
  });
});
