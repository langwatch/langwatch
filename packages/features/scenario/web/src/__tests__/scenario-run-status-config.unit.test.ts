import { describe, expect, it } from "vitest";
import { ScenarioRunStatus } from "@langwatch/scenario-contract";
import { getIconAndColor } from "../ui/elements/scenario-run-status-icon";
import {
  SCENARIO_RUN_STATUS_CONFIG,
  SCENARIO_RUN_STATUS_ICONS,
  type ScenarioRunStatusConfig,
} from "../model/scenario-run-status-config";

const allStatuses = Object.values(ScenarioRunStatus);

describe("scenario-run-status-config", () => {
  describe("SCENARIO_RUN_STATUS_ICONS", () => {
    describe("when checking coverage of ScenarioRunStatus values", () => {
      /** @scenario Lucide-react icon mapping is colocated with the status config */
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
      /** @scenario Config covers every ScenarioRunStatus value */
      it("covers every ScenarioRunStatus value", () => {
        for (const status of allStatuses) {
          expect(SCENARIO_RUN_STATUS_CONFIG[status]).toBeDefined();
        }
      });

      it.each(allStatuses)("has colorPalette, label, isComplete, and fgColor for %s", (status) => {
        const config: ScenarioRunStatusConfig = SCENARIO_RUN_STATUS_CONFIG[status];
        expect(typeof config.colorPalette).toBe("string");
        expect(typeof config.label).toBe("string");
        expect(typeof config.isComplete).toBe("boolean");
        expect(typeof config.fgColor).toBe("string");
      });
    });

    describe("when a run has not settled yet", () => {
      // A run still in flight once read in the same warm colour as a
      // failure, so a list of running scenarios looked like a broken run.
      /** @scenario "A run that is still going does not read as a failure" */
      it("reads in the colour of a queued run, not of a failed one", () => {
        const queued = SCENARIO_RUN_STATUS_CONFIG[ScenarioRunStatus.QUEUED];
        const failed = SCENARIO_RUN_STATUS_CONFIG[ScenarioRunStatus.FAILED];
        const unsettled = [ScenarioRunStatus.RUNNING, ScenarioRunStatus.IN_PROGRESS];

        for (const status of unsettled) {
          const config = SCENARIO_RUN_STATUS_CONFIG[status];
          expect(config.fgColor).toBe(queued.fgColor);
          expect(config.colorPalette).toBe(queued.colorPalette);
          expect(config.fgColor).not.toBe(failed.fgColor);
          expect(config.colorPalette).not.toBe(failed.colorPalette);
        }
      });
    });
  });

  describe("getIconAndColor", () => {
    describe("when called with undefined status", () => {
      it("returns the PENDING icon and PENDING fgColor", () => {
        const result = getIconAndColor(undefined);

        expect(result.icon).toBe(SCENARIO_RUN_STATUS_ICONS[ScenarioRunStatus.PENDING]);
        expect(result.color).toBe(SCENARIO_RUN_STATUS_CONFIG[ScenarioRunStatus.PENDING].fgColor);
      });
    });

    describe("when called with a known status", () => {
      it("returns the matching icon and fgColor", () => {
        const result = getIconAndColor(ScenarioRunStatus.SUCCESS);

        expect(result.icon).toBe(SCENARIO_RUN_STATUS_ICONS[ScenarioRunStatus.SUCCESS]);
        expect(result.color).toBe(SCENARIO_RUN_STATUS_CONFIG[ScenarioRunStatus.SUCCESS].fgColor);
      });
    });
  });
});
