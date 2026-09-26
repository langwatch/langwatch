// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type {
  GovernanceCostDayRecords,
  GovernanceCostProviderDayRow,
} from "@langwatch/enterprise-governance-contract";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { cloneElement, type ReactElement } from "react";
import type * as rechartsModule from "recharts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CostProviderDayPanel } from "../ui/sections/cost-provider-day-panel.tsx";

/**
 * @vitest-environment jsdom
 *
 * What a reader gets after opening the records behind one period.
 *
 * The panel is asserted directly rather than through the costs screen, because
 * the thing under test only exists once a period is open, and opening one is a
 * click on a bar. On the screen those bars are never drawn: the chart's
 * container measures zero under a renderer with no layout, so recharts
 * declines to plot and there is nothing to click. Giving the container a size
 * here is the whole of the difference — the wiring from the bar to the open
 * period is the real one.
 *
 * NOTHING IS EXPORTED FROM THE PANEL FOR THIS FILE'S BENEFIT. The records
 * block is private and stays private: reaching it the way a reader does is
 * what makes these cases evidence about the screen rather than about a
 * function that happens to live near it.
 *
 * Spec: specs/governance/governance-cost-screen.feature
 */

const harness: {
  periodRecords: GovernanceCostDayRecords | undefined;
  periodRecordsFails: boolean;
} = { periodRecords: undefined, periodRecordsFails: false };

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof rechartsModule>();
  return {
    ...actual,
    // The only reason the chart draws at all. Everything below it — the bars,
    // their click handler, the payload the handler reads the day out of — is
    // recharts' own.
    ResponsiveContainer: ({
      children,
    }: {
      children: ReactElement<{ width?: number; height?: number }>;
    }) => cloneElement(children, { width: 640, height: 240 }),
  };
});

vi.mock("../../../behavior/governance-api.ts", () => ({
  api: {
    governanceCost: {
      periodRecords: {
        useQuery: () => ({
          data: harness.periodRecords,
          isLoading: false,
          isError: harness.periodRecordsFails,
        }),
      },
    },
  },
}));

const ROWS: GovernanceCostProviderDayRow[] = [
  {
    day: "2026-01-15",
    provider: "anthropic_admin",
    amountUsd: 41,
    cellsWithoutAmount: 0,
    currenciesWithoutUsdAmount: [],
  },
];

const renderPanel = (rows: readonly GovernanceCostProviderDayRow[] = ROWS) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <CostProviderDayPanel organizationId="org-1" rows={rows} interval="month" />
    </ChakraProvider>,
  );

/**
 * Open the first period by clicking its bar, the way a reader does.
 *
 * Recharts draws each series as `<path class="recharts-rectangle">` inside a
 * `<g class="recharts-bar">`, and hangs the click handler on the rectangle.
 */
const openFirstPeriod = () => {
  const bar = document.querySelector(".recharts-bar .recharts-rectangle");
  if (!bar) throw new Error("no bar was drawn, so no period can be opened");
  fireEvent.click(bar);
};

beforeEach(() => {
  harness.periodRecords = undefined;
  harness.periodRecordsFails = false;
});

afterEach(() => cleanup());

describe("the records behind one period", () => {
  describe("given the read of them failed", () => {
    /**
     * Fails today, and the sentence is the whole of it: the panel says
     * "Refresh to try again" and offers nothing to press. The refresh it means
     * is the screen-wide one, which deliberately does not re-read this — the
     * records behind a day are absent until a period is opened, so a global
     * refresh has nothing to refetch and the instruction is untrue.
     *
     * The assertion is on a CONTROL, not on the reader's options generally.
     * Closing the period and opening it again already remounts the query and
     * would satisfy any looser claim by accident, which is the failure mode
     * this wording exists to avoid.
     */
    /** @scenario "A period that could not be read offers a way to try again" */
    it("offers a control that tries the read again", () => {
      harness.periodRecordsFails = true;
      renderPanel();
      openFirstPeriod();

      const records = within(screen.getByLabelText("Records behind this period"));
      expect(records.getByRole("button", { name: /try again/i })).toBeEnabled();
    });
  });

  describe("given the period holds a bill in a currency with no dollar figure", () => {
    /**
     * The same rule as the provider figure one level up, at the level a reader
     * lands on when they ask what a period was made of. Without it the records
     * add up to less than the period and nothing on screen says why.
     */
    /** @scenario "The records behind a period are marked the same way" */
    it("names the currency the records leave out", () => {
      // On the RECORD, not on the response: the reader is looking for which
      // charge made the period short, and a note over the whole list would
      // leave them guessing between the rows under it.
      harness.periodRecords = {
        unavailableReason: null,
        records: [
          {
            label: "claude-sonnet-5",
            amountUsd: 41,
            cellsWithoutAmount: 0,
            currenciesWithoutUsdAmount: ["EUR"],
          },
        ],
      };
      renderPanel();
      openFirstPeriod();

      const records = screen.getByLabelText("Records behind this period");
      expect(records).toHaveTextContent(/EUR/);
    });
  });
});
