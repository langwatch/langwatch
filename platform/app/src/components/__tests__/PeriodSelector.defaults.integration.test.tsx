/**
 * @vitest-environment jsdom
 *
 * The period selector grew a size, a trigger look and a placement so it can
 * sit at the foot of a rail. Every default draws the control the pages that
 * already use it drew before.
 *
 * @see specs/features/agent-testing/page-structure.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { startOfDay, subDays } from "date-fns";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PeriodSelector } from "../PeriodSelector";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

/**
 * Anchored to the day the test runs. The trigger names a preset only while
 * the range still ends today, so a fixed pair of dates would name the preset
 * on the day it was written and print raw dates on every day after.
 */
const period = {
  startDate: startOfDay(subDays(new Date(), 29)),
  endDate: new Date(),
};

const renderSelector = (
  props: Partial<React.ComponentProps<typeof PeriodSelector>> = {},
) =>
  render(
    <PeriodSelector
      period={period}
      mode="relative"
      setPeriod={vi.fn()}
      setRelativePeriod={vi.fn()}
      {...props}
    />,
    { wrapper: Wrapper },
  );

const trigger = () => screen.getAllByRole("button")[0]!;

describe("<PeriodSelector/> defaults", () => {
  afterEach(cleanup);

  describe("given no size and no trigger look", () => {
    it("draws the trigger a small outline button draws", () => {
      const { unmount } = renderSelector();
      const untouched = trigger().className;
      unmount();

      renderSelector({ size: "sm", triggerVariant: "outline" });

      expect(trigger().className).toBe(untouched);
    });

    it("still names the range on the trigger", () => {
      renderSelector();

      expect(trigger().textContent).toContain("Last 30 days");
    });
  });

  describe("given a compact trigger", () => {
    it("draws a different trigger", () => {
      const { unmount } = renderSelector();
      const untouched = trigger().className;
      unmount();

      renderSelector({ size: "xs", triggerVariant: "ghost" });

      expect(trigger().className).not.toBe(untouched);
    });
  });

  describe("given no placement", () => {
    it("opens the range list where it opened before", async () => {
      const user = userEvent.setup();
      renderSelector();

      await user.click(trigger());

      expect(
        screen.getByRole("button", { name: "Last 7 days" }),
      ).toBeInTheDocument();
    });
  });

  describe("given a placement", () => {
    it("opens the range list", async () => {
      const user = userEvent.setup();
      renderSelector({ placement: "top-start" });

      await user.click(trigger());

      expect(
        screen.getByRole("button", { name: "Last 7 days" }),
      ).toBeInTheDocument();
    });
  });
});
