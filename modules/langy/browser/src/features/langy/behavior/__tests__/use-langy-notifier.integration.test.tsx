/**
 * @vitest-environment jsdom
 *
 * The notifier over a stubbed browser Notification API and the real Langy store.
 * @see specs/langy/langy-notifications.feature
 */
import { useLangyStore } from "../../../../behavior/langy.store.ts";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../behavior/langy-api.ts", () => ({ api: {} }));

import { langyDecisionKeysReady, useLangyNotifier } from "../use-langy-notifications.ts";

const close = vi.fn();

class FakeNotification {
  static permission: NotificationPermission = "granted";
  onclick: (() => void) | null = null;
  close = close;
  body?: string;
  tag?: string;
  constructor(
    public title: string,
    options: { body?: string; tag?: string } = {},
  ) {
    this.body = options.body;
    this.tag = options.tag;
    shown.push(this);
  }
}

const shown: FakeNotification[] = [];

function setAway(away: boolean) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (away ? "hidden" : "visible"),
  });
  vi.spyOn(document, "hasFocus").mockReturnValue(!away);
}

type Props = Parameters<typeof useLangyNotifier>[0];

const base: Props = {
  conversationId: "conv-1",
  conversationTitle: "Set up tracing",
  status: "ready",
  messages: [],
  decisionKeys: [],
  decisionKeysReady: true,
  enabled: true,
  permission: "granted",
};

const notifyPart = {
  type: "tool-notify",
  state: "output-available",
  toolCallId: "call-1",
  input: { title: "Your project is ready", body: "Tracing and a suite are set up." },
};

beforeEach(() => {
  shown.length = 0;
  close.mockClear();
  vi.stubGlobal("Notification", FakeNotification);
  useLangyStore.setState({ isOpen: false, activeConversationId: null });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useLangyNotifier", () => {
  describe("given Langy notifications are enabled and the tab is hidden", () => {
    describe("when Langy calls the notify tool during a turn", () => {
      /** @scenario "The notify tool shows its title and body when I am away" */
      it("shows that title and body", () => {
        setAway(true);
        const view = renderHook((props: Props) => useLangyNotifier(props), {
          initialProps: { ...base, status: "streaming" },
        });

        view.rerender({
          ...base,
          status: "streaming",
          messages: [{ role: "assistant", parts: [notifyPart] }],
        });

        expect(shown).toHaveLength(1);
        expect(shown[0]?.title).toBe("Your project is ready");
        expect(shown[0]?.body).toBe("Tracing and a suite are set up.");
      });
    });

    describe("when a history holding an old notify call is opened", () => {
      it("shows nothing", () => {
        setAway(true);
        renderHook(() =>
          useLangyNotifier({ ...base, messages: [{ role: "assistant", parts: [notifyPart] }] }),
        );

        expect(shown).toHaveLength(0);
      });
    });
  });

  describe("given a Langy notification was shown for a conversation", () => {
    describe("when I click it", () => {
      /** @scenario "Clicking a notification focuses the tab and opens the conversation" */
      it("focuses the tab and opens the panel on that conversation", () => {
        setAway(true);
        const focus = vi.fn();
        vi.stubGlobal("focus", focus);
        const view = renderHook((props: Props) => useLangyNotifier(props), {
          initialProps: base,
        });
        view.rerender({ ...base, decisionKeys: ["wait-1"] });
        expect(shown).toHaveLength(1);

        shown[0]?.onclick?.();

        expect(focus).toHaveBeenCalledOnce();
        expect(close).toHaveBeenCalledOnce();
        expect(useLangyStore.getState().isOpen).toBe(true);
        expect(useLangyStore.getState().activeConversationId).toBe("conv-1");
      });
    });
  });

  describe("given the tab is visible and focused", () => {
    it("shows nothing for a new decision", () => {
      setAway(false);
      const view = renderHook((props: Props) => useLangyNotifier(props), {
        initialProps: base,
      });

      view.rerender({ ...base, decisionKeys: ["wait-1"] });

      expect(shown).toHaveLength(0);
    });
  });
});

describe("langyDecisionKeysReady", () => {
  describe("given a reopened conversation whose record loads after its folder state", () => {
    /** @scenario "A card already waiting when I reopen a conversation sends nothing" */
    it("is not ready until the record is read too", () => {
      expect(langyDecisionKeysReady({ workspaceFetched: true, recordFetched: false })).toBe(false);
      expect(langyDecisionKeysReady({ workspaceFetched: false, recordFetched: true })).toBe(false);
      expect(langyDecisionKeysReady({ workspaceFetched: true, recordFetched: true })).toBe(true);
    });

    it("takes the waiting card as the baseline, so it notifies nothing", () => {
      setAway(true);
      const view = renderHook((props: Props) => useLangyNotifier(props), {
        initialProps: {
          ...base,
          decisionKeysReady: langyDecisionKeysReady({
            workspaceFetched: true,
            recordFetched: false,
          }),
        },
      });
      view.rerender({
        ...base,
        decisionKeys: ["wait-open-before"],
        decisionKeysReady: langyDecisionKeysReady({ workspaceFetched: true, recordFetched: true }),
      });

      expect(shown).toHaveLength(0);
    });
  });
});
