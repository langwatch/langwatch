/**
 * Integration tests for SimulationConsole's status line.
 * @vitest-environment jsdom
 * @see modules/scenario/specs/red-team-scenario.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { SimulationRunStatus } from "@langwatch/scenario-contract";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SimulationConsole } from "../simulation-console.tsx";

describe("<SimulationConsole />", () => {
  afterEach(cleanup);

  describe("when a red team run supplies its own status line", () => {
    /** @scenario The run view shows a held red team run */
    it("shows the status line in place of passed or failed", () => {
      renderWithDesignSystem(
        <SimulationConsole status={SimulationRunStatus.SUCCESS} statusLine={<span>Held</span>} />,
      );

      expect(screen.getByText("Held")).toBeTruthy();
      expect(screen.queryByText(/PASSED|FAILED|SUCCESS/)).toBeNull();
    });
  });

  describe("when no status line is supplied", () => {
    it("shows the pass or fail status", () => {
      renderWithDesignSystem(<SimulationConsole status={SimulationRunStatus.SUCCESS} />);

      expect(screen.getByText(/SUCCESS/)).toBeTruthy();
    });
  });
});
