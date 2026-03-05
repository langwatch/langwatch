import { describe, expect, it } from "vitest";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import {
  SCENARIO_RUN_STATUS_CONFIG,
  SCENARIO_RUN_STATUS_ICONS,
  type ScenarioRunStatusConfig,
} from "../scenario-run-status-config";
import { getIconAndColor } from "../ScenarioRunStatusIcon";

const allStatuses = Object.values(ScenarioRunStatus);

describe("scenario-run-status-config", () => {
  describe("SCENARIO_RUN_STATUS_ICONS", () => {
    describe("when checking coverage of ScenarioRunStatus values", () => {
      it("exports a lucide-react icon for every ScenarioRunStatus value", () => {
        for (const status of allStatuses) {
          expect(SCENARIO_RUN_STATUS_ICONS[status]).toBeDefined();
        }
      });

      it("maps to valid React components (lucide-react icons)", () => {
        for (const status of allStatuses) {
          const icon = SCENARIO_RUN_STATUS_ICONS[status];
          expect(typeof icon === "object" && icon !== null).toBe(true);
        }
      });
    });
  });

  describe("SCENARIO_RUN_STATUS_CONFIG", () => {
    describe("when looking up config for each ScenarioRunStatus value", () => {
      it("covers every ScenarioRunStatus value", () => {
        for (const status of allStatuses) {
          expect(SCENARIO_RUN_STATUS_CONFIG[status]).toBeDefined();
        }
      });

      it.each(allStatuses)(
        "has colorPalette, label, isComplete, and fgColor for %s",
        (status) => {
          const config: ScenarioRunStatusConfig =
            SCENARIO_RUN_STATUS_CONFIG[status];
          expect(typeof config.colorPalette).toBe("string");
          expect(typeof config.label).toBe("string");
          expect(typeof config.isComplete).toBe("boolean");
          expect(typeof config.fgColor).toBe("string");
        },
      );
    });
  });

  describe("getIconAndColor", () => {
    describe("when called with undefined status", () => {
      it("returns the PENDING icon and PENDING fgColor", () => {
        const result = getIconAndColor(undefined);

        expect(result.icon).toBe(
          SCENARIO_RUN_STATUS_ICONS[ScenarioRunStatus.PENDING],
        );
        expect(result.color).toBe(
          SCENARIO_RUN_STATUS_CONFIG[ScenarioRunStatus.PENDING].fgColor,
        );
      });
    });

    describe("when called with a known status", () => {
      it("returns the matching icon and fgColor", () => {
        const result = getIconAndColor(ScenarioRunStatus.SUCCESS);

        expect(result.icon).toBe(
          SCENARIO_RUN_STATUS_ICONS[ScenarioRunStatus.SUCCESS],
        );
        expect(result.color).toBe(
          SCENARIO_RUN_STATUS_CONFIG[ScenarioRunStatus.SUCCESS].fgColor,
        );
      });
    });
  });
});
