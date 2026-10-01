// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The seat lane of the Costs screen: a hole until a licence list is read, the
 * counts once it is, and a meter that states its level by length alone.
 *
 * Spec: specs/governance/governance-cost-screen.feature and
 * specs/ai-governance/dashboard/governance-ui-controls.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/design-system/meter-bar", () => ({
  MeterBar: (props: { fillRatio: number | null; fillColor: string }) => (
    <div
      data-testid="seat-pool-meter"
      data-fill-ratio={props.fillRatio}
      data-fill-colour={props.fillColor}
    />
  ),
}));

import { seatPoolName } from "../model/cost-lane-format.ts";
import { SeatLanePanel } from "../ui/blocks/cost-lane-panel.tsx";

type SeatLane = Parameters<typeof SeatLanePanel>[0]["seats"];

const renderLane = (seats: SeatLane) =>
  renderWithDesignSystem(<SeatLanePanel seats={seats} testId="seat-lane" />);

const pool = ({ sku, bought, assigned }: { sku: string; bought: number; assigned: number }) => ({
  skuPartNumber: sku,
  day: "2026-09-01",
  seatsBought: bought,
  seatsAssigned: assigned,
});

afterEach(() => cleanup());

describe("the seat lane", () => {
  describe("given no licence list has been read", () => {
    /** @scenario "The seat lane is an honest hole until a licence list is read" */
    it("is present, labelled, says the data is not yet available and shows no digit", () => {
      renderLane({ status: "awaiting_data" });

      const lane = screen.getByTestId("seat-lane");
      expect(within(lane).getByText("Seats")).toBeInTheDocument();
      expect(lane).toHaveTextContent("Seat data is not yet available");
      expect(lane.textContent).not.toMatch(/\d/);
    });
  });

  describe("given a pool with seats bought and some assigned", () => {
    /** @scenario "The seat lane shows how many seats are bought and how many are assigned" */
    it("names the pool, shows both counts and no currency figure", () => {
      renderLane({
        status: "reported",
        pools: [pool({ sku: "COPILOT_STUDIO", bought: 140, assigned: 96 })],
      });

      const lane = screen.getByTestId("seat-lane");
      expect(lane).toHaveTextContent(seatPoolName("COPILOT_STUDIO"));
      expect(lane).toHaveTextContent("96 / 140");
      expect(lane.textContent).not.toMatch(/[$€£]|USD|EUR/);
    });
  });

  describe("given the seat read failed", () => {
    it("says the data could not be read, and not that it is yet to arrive, with no digit", () => {
      renderLane({ status: "read_failed" });

      const lane = screen.getByTestId("seat-lane");
      expect(lane).toHaveTextContent("Seat data could not be read");
      expect(lane).not.toHaveTextContent("not yet available");
      expect(lane.textContent).not.toMatch(/\d/);
    });
  });

  describe("given one pool nearly all idle and one nearly all assigned", () => {
    /** @scenario "A meter states its level by length rather than by a colour that grades it" */
    it("draws the fills at different lengths in the same colour", () => {
      renderLane({
        status: "reported",
        pools: [
          pool({ sku: "IDLE_POOL", bought: 100, assigned: 5 }),
          pool({ sku: "BUSY_POOL", bought: 100, assigned: 95 }),
        ],
      });

      const [idle, busy] = screen.getAllByTestId("seat-pool-meter");
      expect(Number(idle?.getAttribute("data-fill-ratio"))).toBeLessThan(
        Number(busy?.getAttribute("data-fill-ratio")),
      );
      expect(idle?.getAttribute("data-fill-colour")).toBe(busy?.getAttribute("data-fill-colour"));
      expect(idle?.getAttribute("data-fill-colour")).toBeTruthy();
    });
  });
});
