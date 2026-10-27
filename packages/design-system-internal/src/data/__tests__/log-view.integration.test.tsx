// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LOG_VIRTUALISE_ABOVE, LogView, type LogLine } from "../log-view.tsx";

const ROW = 20;
const VIEWPORT = 200;

const linesOf = ({ count }: { count: number }): LogLine[] =>
  Array.from({ length: count }, (_, index) => ({ id: String(index), text: `line ${index}` }));

/** jsdom lays nothing out, so the scroller's geometry follows the line count by hand. */
const giveGeometry = ({ element, count }: { element: HTMLElement; count: () => number }) => {
  let top = 0;
  Object.defineProperty(element, "clientHeight", { configurable: true, get: () => VIEWPORT });
  Object.defineProperty(element, "scrollHeight", { configurable: true, get: () => count() * ROW });
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = Math.max(0, Math.min(value, count() * ROW - VIEWPORT));
    },
  });
};

const renderFollowing = () => {
  let lines = linesOf({ count: 20 });
  const view = render(<LogView lines={lines} />);
  const scroller = screen.getByRole("log");
  giveGeometry({ element: scroller, count: () => lines.length });
  const append = ({ count }: { count: number }) => {
    lines = linesOf({ count: lines.length + count });
    view.rerender(<LogView lines={lines} />);
  };
  append({ count: 1 });
  return { scroller, append, bottom: () => lines.length * ROW - VIEWPORT };
};

describe("LogView", () => {
  afterEach(() => cleanup());

  describe("when following the tail", () => {
    it("scrolls to each new line", () => {
      const { scroller, append, bottom } = renderFollowing();

      append({ count: 5 });

      expect(scroller.scrollTop).toBe(bottom());
      expect(screen.queryByRole("button", { name: "Jump to latest" })).toBeNull();
    });
  });

  describe("when the reader scrolls up", () => {
    it("stops following and offers to jump back", () => {
      const { scroller, append } = renderFollowing();

      scroller.scrollTop = 0;
      fireEvent.scroll(scroller);
      append({ count: 5 });

      expect(scroller.scrollTop).toBe(0);
      expect(screen.getByRole("button", { name: "Jump to latest" }).textContent).toBe(
        "Jump to latest",
      );
    });

    it("resumes following from Jump to latest", () => {
      const { scroller, append, bottom } = renderFollowing();

      scroller.scrollTop = 0;
      fireEvent.scroll(scroller);
      fireEvent.click(screen.getByRole("button", { name: "Jump to latest" }));
      append({ count: 3 });

      expect(scroller.scrollTop).toBe(bottom());
    });
  });

  describe("when there are more lines than the virtualisation threshold", () => {
    it("renders only a window of them", () => {
      const lines = linesOf({ count: LOG_VIRTUALISE_ABOVE + 1000 });

      render(<LogView lines={lines} follow={false} />);

      const rendered = screen.getByRole("log").querySelectorAll(".ds-log-line").length;
      expect(rendered).toBeGreaterThan(0);
      expect(rendered).toBeLessThan(200);
    });
  });
});
