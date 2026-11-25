// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LOG_VIRTUALISE_ABOVE, LogView, type LogLine } from "../log-view.tsx";

afterEach(() => cleanup());

const marks = () => Array.from(document.querySelectorAll("mark.ds-log-mark"), (m) => m.textContent);

describe("<LogView/> highlight", () => {
  describe("when the log wraps", () => {
    it("marks every case-insensitive match and keeps the line's text whole", () => {
      render(
        <LogView
          lines={[{ text: "API listening; api ready" }, { text: "worker drained" }]}
          highlight="api"
        />,
      );

      expect(marks()).toEqual(["API", "api"]);
      expect(screen.getByText(/listening/u).closest(".ds-log-text")?.textContent).toBe(
        "API listening; api ready",
      );
    });

    it("treats the query as text, not a pattern", () => {
      render(<LogView lines={[{ text: "GET /a?b=1 (200)" }]} highlight="?b=1 (" />);

      expect(marks()).toEqual(["?b=1 ("]);
    });
  });

  describe("when the log is virtualised", () => {
    it("marks matches in the rendered rows", () => {
      const lines: LogLine[] = Array.from({ length: LOG_VIRTUALISE_ABOVE + 1 }, (_, index) => ({
        text: index === 0 ? "Redis slow reply" : `line ${index}`,
      }));
      render(<LogView lines={lines} follow={false} highlight="REDIS" />);

      expect(marks()).toEqual(["Redis"]);
    });
  });

  describe("when no highlight is given", () => {
    it("marks nothing", () => {
      render(<LogView lines={[{ text: "api listening" }]} />);

      expect(marks()).toEqual([]);
    });
  });
});
