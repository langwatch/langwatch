// @vitest-environment jsdom
import type { PresenceLocation } from "@langwatch/presence-contract";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePresence } from "../use-presence.ts";

const { update, leave, presenceState } = vi.hoisted(() => ({
  update: vi.fn(() => Promise.resolve()),
  leave: vi.fn(() => Promise.resolve()),
  presenceState: {
    setSelfSessionId: () => undefined,
    applyEvent: () => undefined,
    reset: () => undefined,
  },
}));

vi.mock("../../../../../behavior/trace-api.ts", () => ({
  api: {
    presence: {
      update: { useMutation: () => ({ mutateAsync: update }) },
      leave: { useMutation: () => ({ mutateAsync: leave }) },
      onPresenceUpdate: {},
    },
  },
}));
vi.mock("@langwatch/browser-host/sse-subscription", () => ({
  useSSESubscription: () => undefined,
}));
vi.mock("../../../../../behavior/presence/use-tab-session-id.ts", () => ({
  useTabSessionId: () => "tab-1",
}));
vi.mock("../../../../../behavior/presence/presence-store.ts", () => ({
  usePresenceStore: (select: (state: typeof presenceState) => unknown) => select(presenceState),
}));
vi.mock("../../../../../behavior/presence/presence-preferences-store.ts", () => ({
  usePresencePreferencesStore: (select: (state: { hidden: boolean }) => unknown) =>
    select({ hidden: false }),
}));

const location: PresenceLocation = { lens: "traces", route: {} };

function setTabHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

describe("usePresence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    update.mockClear();
  });
  afterEach(() => {
    setTabHidden(false);
    vi.useRealTimers();
  });

  describe("when the tab is hidden", () => {
    it("sends no heartbeat, and re-announces once it is shown again", () => {
      renderHook(() => usePresence({ projectId: "project-1", location }));
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(update).toHaveBeenCalledTimes(1);

      setTabHidden(true);
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(update).toHaveBeenCalledTimes(1);

      setTabHidden(false);
      expect(update).toHaveBeenCalledTimes(2);
    });
  });
});
