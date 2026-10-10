// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PostEventProvider } from "../use-post-event.tsx";

const { fetchSSE, scope } = vi.hoisted(() => ({
  fetchSSE: vi.fn(() => Promise.resolve()),
  scope: { project: { id: "project-1" } },
}));

vi.mock("@langwatch/browser-host/fetch-sse", () => ({ fetchSSE }));
vi.mock("../../../../behavior/studio-host/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => scope,
}));

function setTabHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

describe("PostEventProvider", () => {
  afterEach(() => {
    setTabHidden(false);
    vi.useRealTimers();
  });

  describe("when the tab is hidden", () => {
    it("stops the is_alive poll until the tab is shown again", () => {
      vi.useFakeTimers();
      render(<PostEventProvider>{null}</PostEventProvider>);
      expect(fetchSSE).toHaveBeenCalledTimes(1);
      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      expect(fetchSSE).toHaveBeenCalledTimes(2);

      setTabHidden(true);
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(fetchSSE).toHaveBeenCalledTimes(2);

      setTabHidden(false);
      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      expect(fetchSSE).toHaveBeenCalledTimes(3);
    });
  });
});
