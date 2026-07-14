// @vitest-environment jsdom
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildScenarioChipDef, type ScenarioChipData } from "../ScenarioChip";

function buildScenarioData(
  overrides: Partial<ScenarioChipData> = {},
): ScenarioChipData {
  return {
    scenarioRunId: "scenario_run_1",
    isReadOnly: false,
    name: "Checkout flow",
    isLoading: false,
    status: undefined,
    statusKey: undefined,
    durationInMs: null,
    metCriteria: [],
    unmetCriteria: [],
    reasoning: null,
    openScenarioDrawer: () => undefined,
    ...overrides,
  };
}

describe("buildScenarioChipDef", () => {
  describe("when the trace viewer is read-only", () => {
    it("does not advertise an unavailable open action", () => {
      const chip = buildScenarioChipDef(
        buildScenarioData({ isReadOnly: true, openScenarioDrawer: undefined }),
      );

      render(
        <ChakraProvider value={defaultSystem}>{chip.tooltip}</ChakraProvider>,
      );

      expect(
        screen.queryByText("Click to open the scenario run"),
      ).not.toBeInTheDocument();
      expect(chip.ariaLabel).toBe("Scenario run Checkout flow");
    });
  });

  describe("when the trace viewer is editable", () => {
    it("keeps the open action copy", () => {
      const chip = buildScenarioChipDef(buildScenarioData());

      render(
        <ChakraProvider value={defaultSystem}>{chip.tooltip}</ChakraProvider>,
      );

      expect(
        screen.getByText("Click to open the scenario run"),
      ).toBeInTheDocument();
      expect(chip.ariaLabel).toBe("Open scenario run Checkout flow");
    });
  });
});
