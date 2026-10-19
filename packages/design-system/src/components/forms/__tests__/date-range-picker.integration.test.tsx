// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithDesignSystem } from "../../../testing/index.tsx";
import { DateRangePicker } from "../date-range-picker.tsx";

afterEach(cleanup);

const PRESETS = [
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
] as const;

describe("DateRangePicker", () => {
  describe("given the active preset key", () => {
    it("marks only that preset as the current one", async () => {
      renderWithDesignSystem(
        <DateRangePicker
          presets={PRESETS}
          activePresetKey="30d"
          triggerLabel="Last 30 days"
          onPresetSelect={vi.fn()}
        />,
      );

      await userEvent.click(screen.getByRole("button", { name: /Last 30 days/ }));

      expect(screen.getByRole("button", { name: "Last 30 days", current: true })).toHaveAttribute(
        "data-selected",
      );
      expect(screen.getByRole("button", { name: "Last 7 days" })).not.toHaveAttribute(
        "aria-current",
      );
    });
  });
});
