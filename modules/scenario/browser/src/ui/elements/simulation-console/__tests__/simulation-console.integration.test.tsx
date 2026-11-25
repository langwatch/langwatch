/**
 * Integration tests for SimulationConsole's status line.
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { SimulationRunStatus } from "@langwatch/scenario-contract";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SimulationConsole } from "../simulation-console.tsx";

describe("<SimulationConsole />", () => {
  afterEach(cleanup);

  describe("when the run passed", () => {
    it("shows the pass status", () => {
      renderWithDesignSystem(<SimulationConsole status={SimulationRunStatus.SUCCESS} />);

      expect(screen.getByText("Status:")).toBeTruthy();
      expect(screen.getByText("SUCCESS")).toBeTruthy();
      expect(screen.queryByText("FAILED")).toBeNull();
    });
  });

  describe("when the run failed", () => {
    it("shows the fail status", () => {
      renderWithDesignSystem(<SimulationConsole status={SimulationRunStatus.FAILED} />);

      expect(screen.getByText("Status:")).toBeTruthy();
      expect(screen.getByText("FAILED")).toBeTruthy();
      expect(screen.queryByText("SUCCESS")).toBeNull();
    });
  });
});
