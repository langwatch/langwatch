import type * as BrowserHostAnalytics from "@langwatch/browser-host/analytics";
import type { UiAnalyticsEvent } from "@langwatch/browser-host/analytics";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * @vitest-environment jsdom
 * @see modules/dashboard/specs/dashboards-telemetry.feature
 */
import { useLangyStore } from "../../../../behavior/langy.store.ts";
import { useLangyPanelSend } from "../panel/use-langy-panel-send.ts";

const tracked = vi.hoisted(() => ({ events: [] as UiAnalyticsEvent[] }));

vi.mock("@langwatch/browser-host/analytics", async (importActual) => {
  const actual = await importActual<typeof BrowserHostAnalytics>();
  return {
    ...actual,
    useUiAnalytics: () => ({ track: (event: UiAnalyticsEvent) => tracked.events.push(event) }),
  };
});

function render() {
  const sendMessage = vi.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() =>
    useLangyPanelSend({
      projectId: "proj_1",
      isBusy: false,
      latestAssistantMessageId: void 0,
      lastSentTextRef: { current: null },
      resetRecovery: vi.fn(),
      sendMessage,
      restoreDraftOnFailure: vi.fn(),
    }),
  );
  return { send: result.current, sendMessage };
}

beforeEach(() => {
  tracked.events.length = 0;
  useLangyStore.setState({ draft: "" });
});

describe("useLangyPanelSend", () => {
  describe("given a member sending from Langy's composer", () => {
    /** @scenario "Telemetry: a question typed in Langy's composer sends langy.asked.question" */
    it("sends one question asked from the composer, without its text", async () => {
      const { send, sendMessage } = render();

      await act(() => send("How many traces failed today?", { askedFrom: "composer" }));

      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(tracked.events).toEqual([
        {
          boundary: "langy",
          action: "asked",
          name: "question",
          attributes: { surface: "composer" },
        },
      ]);
    });

    /** @scenario "Telemetry: a question typed in Langy's composer sends langy.asked.question" */
    it("sends nothing for an empty send or the /feedback command", async () => {
      const { send, sendMessage } = render();

      await act(() => send("   ", { askedFrom: "composer" }));
      await act(() => send("/feedback", { askedFrom: "composer" }));

      expect(sendMessage).not.toHaveBeenCalled();
      expect(tracked.events).toEqual([]);
    });
  });

  describe("given a question a board handed over and the panel sends for the member", () => {
    /** @scenario "Telemetry: a question typed in Langy's composer sends langy.asked.question" */
    it("sends no second question asked", async () => {
      const { send, sendMessage } = render();

      await act(() => send("Explain this board"));

      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(tracked.events).toEqual([]);
    });
  });
});
