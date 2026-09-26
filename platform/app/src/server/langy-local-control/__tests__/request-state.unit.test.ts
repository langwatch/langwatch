/**
 * What became of a conversation's latest control request, read off the open
 * request Redis still holds and the conversation's own event log.
 *
 * @see specs/langy/langy-code-access.feature
 */
import { LANGY_CONVERSATION_EVENT_TYPES } from "@langwatch/langy";
import { describe, expect, it } from "vitest";
import {
  type ControlRequestHistoryEvent,
  controlRequestState,
  latestControlRequest,
} from "../request-state";

const NOW = 1_700_000_000_000;
const FIFTEEN_MINUTES = 15 * 60 * 1000;

const requested = (
  requestId: string,
  expiresAt: number,
): ControlRequestHistoryEvent => ({
  type: LANGY_CONVERSATION_EVENT_TYPES.LOCAL_CONTROL_REQUESTED,
  data: { conversationId: "conv_1", requestId, userId: "user_1", expiresAt },
});
const connected = (requestId: string): ControlRequestHistoryEvent => ({
  type: LANGY_CONVERSATION_EVENT_TYPES.LOCAL_WORKSPACE_CONNECTED,
  data: { conversationId: "conv_1", requestId, instanceId: "lci_1" },
});
const disconnected = (): ControlRequestHistoryEvent => ({
  type: LANGY_CONVERSATION_EVENT_TYPES.LOCAL_WORKSPACE_DISCONNECTED,
  data: { conversationId: "conv_1", instanceId: "lci_1", reason: "cli_exit" },
});

/** The state as the workspace read computes it, from one history. */
function stateOf({
  events,
  open = null,
  claimed = false,
  isConnected = false,
}: {
  events: ControlRequestHistoryEvent[];
  open?: { expiresAt: number } | null;
  claimed?: boolean;
  isConnected?: boolean;
}) {
  return controlRequestState({
    open,
    latest: latestControlRequest(events),
    claimed,
    connected: isConnected,
    now: NOW,
  });
}

describe("controlRequestState", () => {
  /** @scenario "The platform says what became of the conversation's latest request" */
  it.each([
    {
      history: "is within its fifteen minutes",
      events: [requested("lcr_1", NOW + FIFTEEN_MINUTES)],
      open: { expiresAt: NOW + FIFTEEN_MINUTES },
      state: "open",
    },
    {
      history: "was approved and the folder is connected",
      events: [requested("lcr_1", NOW + FIFTEEN_MINUTES), connected("lcr_1")],
      isConnected: true,
      state: "approved",
    },
    {
      history: "is past its fifteen minutes",
      events: [requested("lcr_1", NOW - 1)],
      state: "expired",
    },
    {
      history: "was declined in the terminal before it expired",
      events: [requested("lcr_1", NOW + FIFTEEN_MINUTES)],
      state: "declined",
    },
    {
      history: "was approved and the share has ended",
      events: [
        requested("lcr_1", NOW + FIFTEEN_MINUTES),
        connected("lcr_1"),
        disconnected(),
      ],
      state: "ended",
    },
    { history: "never existed", events: [], state: "none" },
  ])("reads a request that $history as $state", ({ state, ...history }) => {
    expect(stateOf(history)).toBe(state);
  });

  describe("when the terminal approved the request and the folder is on its way", () => {
    it("still reads as open, because nothing was declined", () => {
      expect(
        stateOf({
          events: [requested("lcr_1", NOW + FIFTEEN_MINUTES)],
          claimed: true,
        }),
      ).toBe("open");
    });
  });

  describe("when the open request Redis holds is already past its time", () => {
    it("reads as expired", () => {
      expect(
        stateOf({
          events: [requested("lcr_1", NOW - 1)],
          open: { expiresAt: NOW - 1 },
        }),
      ).toBe("expired");
    });
  });
});

describe("latestControlRequest", () => {
  describe("when the conversation asked more than once", () => {
    it("reads the last request, and only a connection made through it", () => {
      const latest = latestControlRequest([
        requested("lcr_1", NOW - FIFTEEN_MINUTES),
        connected("lcr_1"),
        disconnected(),
        requested("lcr_2", NOW + FIFTEEN_MINUTES),
      ]);

      expect(latest).toEqual({
        requestId: "lcr_2",
        expiresAt: NOW + FIFTEEN_MINUTES,
        approved: false,
      });
    });
  });

  describe("when a request event carries no readable expiry", () => {
    it("skips it rather than guessing", () => {
      expect(
        latestControlRequest([
          {
            type: LANGY_CONVERSATION_EVENT_TYPES.LOCAL_CONTROL_REQUESTED,
            data: { requestId: "lcr_1" },
          },
        ]),
      ).toBeNull();
    });
  });
});
