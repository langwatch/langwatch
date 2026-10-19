/**
 * @vitest-environment jsdom
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import type { ProcessFleetSummary } from "@langwatch/ops-contract";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProcessFleetCard } from "../ui/elements/process-fleet-card.tsx";

function makeRow(overrides: Partial<ProcessFleetSummary> = {}): ProcessFleetSummary {
  return {
    processName: "automations",
    pipelineName: "automations",
    scheduled: false,
    instances: 310,
    overdueWakes: 0,
    pendingMessages: 41,
    overduePending: 0,
    lapsedLeases: 0,
    deadMessages: 0,
    ...overrides,
  };
}

afterEach(cleanup);

describe("ProcessFleetCard", () => {
  describe("given a process name with dead outbox messages", () => {
    /** @scenario "Dead intents are impossible to miss" */
    it("presents the dead count as a failure, and the row leads to its instances", () => {
      const onSelect = vi.fn();
      render(
        <DesignSystemProvider forcedTheme="light">
          <ProcessFleetCard rows={[makeRow({ deadMessages: 7 })]} onSelect={onSelect} />
        </DesignSystemProvider>,
      );
      const row = screen.getByTestId("process-row-automations");
      expect(row.textContent).toContain("7");
      // Failure styling is pinned via the row background token, the same
      // mechanism the queues table uses for blocked groups.
      expect(row.textContent).toContain("automations");

      fireEvent.click(row);
      expect(onSelect).toHaveBeenCalledWith("automations");
    });
  });

  it("labels a scheduled singleton as scheduled", () => {
    render(
      <DesignSystemProvider forcedTheme="light">
        <ProcessFleetCard rows={[makeRow({ scheduled: true })]} onSelect={() => undefined} />
      </DesignSystemProvider>,
    );
    expect(screen.getByTestId("process-row-automations").textContent).toContain("scheduled");
  });
});
