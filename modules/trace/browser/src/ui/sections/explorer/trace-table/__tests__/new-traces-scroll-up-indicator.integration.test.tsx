/**
 * @vitest-environment jsdom
 *
 * The floating pill that tells a reader scrolled down the table how many
 * traces arrived above them.
 * @see specs/traces-v2/trace-table.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { useSseStatusStore } from "../../../../../behavior/sse-status.store.ts";
import { NewTracesScrollUpIndicator } from "../new-traces-scroll-up-indicator.tsx";

const arrivals = vi.hoisted(() => ({ count: 0, acknowledge: vi.fn() }));

vi.mock("../../hooks/use-trace-new-count.ts", () => ({
  useTraceNewCount: () => ({ count: arrivals.count, acknowledge: arrivals.acknowledge }),
}));

function scrollContainer({ scrollTop }: { scrollTop: number }) {
  const el = document.createElement("div");
  const scrollTo = vi.fn<(options?: ScrollToOptions) => void>();
  Object.defineProperty(el, "scrollTo", { value: scrollTo });
  Object.defineProperty(el, "scrollTop", { value: scrollTop, writable: true });
  return { el, scrollTo };
}

beforeEach(() => {
  arrivals.count = 0;
  arrivals.acknowledge.mockReset();
  useSseStatusStore.setState({ liveUpdatesMode: "live" });
});

afterEach(cleanup);

describe("the new-traces scroll-up indicator", () => {
  describe("given the reader has scrolled away from the top and traces arrived above", () => {
    /** @scenario Newly-arrived ids surface a scroll-up indicator */
    it("shows the count of unseen traces, and a click scrolls the table back to the top", () => {
      arrivals.count = 3;
      const { el, scrollTo } = scrollContainer({ scrollTop: 400 });
      renderWithDesignSystem(<NewTracesScrollUpIndicator scrollRef={{ current: el }} />);

      const pill = screen.getByRole("button", { name: "3 new traces above: scroll up" });
      expect(pill).toHaveTextContent("3");

      fireEvent.click(pill);

      expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
      expect(arrivals.acknowledge).toHaveBeenCalledTimes(1);
    });
  });

  describe("given the reader is at the top of the table", () => {
    it("stays hidden even when traces arrived", () => {
      arrivals.count = 3;
      const { el } = scrollContainer({ scrollTop: 0 });
      renderWithDesignSystem(<NewTracesScrollUpIndicator scrollRef={{ current: el }} />);

      expect(screen.queryByRole("button")).toBeNull();
    });
  });
});
