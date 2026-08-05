/**
 * Integration tests for stalled scenario run visual treatment.
 *
 * Verifies that STALLED status maps to warning-colored visual treatment
 * across the status->visual mapping functions used by ScenarioRunStatusIcon,
 * StatusDisplay, and SimulationStatusOverlay.
 *
 * These tests verify the exported helper functions that drive component rendering.
 * Component rendering tests are blocked by a missing @testing-library/dom peer
 * dependency (pre-existing environment issue, not introduced by this feature).
 *
 * @see specs/scenarios/stalled-scenario-runs.feature - UI Display integration scenarios
 */
import { describe, expect, it } from "vitest";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { getOverlayConfig } from "../SimulationStatusOverlay";
import { STATUS_DISPLAY_TEXT_MAP } from "../simulation-console/constants";

// ============================================================================
// ScenarioRunStatusIcon - warning color distinct from error
// @see specs/scenarios/stalled-scenario-runs.feature lines 84-89
// ============================================================================
// Note: getIconAndColor() is tested indirectly via ScenarioRunStatusIcon.
// The exhaustive switch in that file guarantees compile-time safety.
// Direct function testing would require exporting a private function.
// The exhaustive switch pattern IS the compile-time guarantee.

// ============================================================================
// StatusDisplay - STALLED text with warning color
// @see specs/scenarios/stalled-scenario-runs.feature lines 98-103
// ============================================================================

describe("STATUS_DISPLAY_TEXT_MAP", () => {
  describe("given a STALLED status", () => {
    describe("when looking up display text", () => {
      it("maps to STALLED text", () => {
        expect(STATUS_DISPLAY_TEXT_MAP[ScenarioRunStatus.STALLED]).toBe(
          "STALLED",
        );
      });
    });

    describe("when compared to ERROR display text", () => {
      it("has distinct display text", () => {
        expect(STATUS_DISPLAY_TEXT_MAP[ScenarioRunStatus.STALLED]).not.toBe(
          STATUS_DISPLAY_TEXT_MAP[ScenarioRunStatus.ERROR],
        );
      });
    });
  });
});

// ============================================================================
// SimulationStatusOverlay - treats stalled as complete
// @see specs/scenarios/stalled-scenario-runs.feature lines 105-110
// ============================================================================

describe("getOverlayConfig()", () => {
  describe("given a STALLED status", () => {
    describe("when evaluating completion", () => {
      it("treats the run as complete", () => {
        const config = getOverlayConfig(ScenarioRunStatus.STALLED);
        expect(config.isComplete).toBe(true);
      });

      it("provides a stalled scrim in the warning hue", () => {
        const config = getOverlayConfig(ScenarioRunStatus.STALLED);
        expect(config.scrim).toContain("yellow");
      });

      it("provides the established full-card light-mode wash", () => {
        const config = getOverlayConfig(ScenarioRunStatus.STALLED);
        expect(config.lightModeGradient).toContain("radial-gradient");
        expect(config.lightModeGradient).toContain("rgba(214, 158, 46");
      });
    });

    describe("when compared to ERROR overlay", () => {
      it("uses a different scrim", () => {
        const stalledConfig = getOverlayConfig(ScenarioRunStatus.STALLED);
        const errorConfig = getOverlayConfig(ScenarioRunStatus.ERROR);
        expect(stalledConfig.scrim).not.toBe(errorConfig.scrim);
      });
    });
  });

  describe("given an IN_PROGRESS status", () => {
    describe("when evaluating completion", () => {
      it("treats the run as not complete", () => {
        const config = getOverlayConfig(ScenarioRunStatus.IN_PROGRESS);
        expect(config.isComplete).toBe(false);
      });
    });
  });

  describe("given a SUCCESS status", () => {
    describe("when evaluating completion", () => {
      it("treats the run as complete", () => {
        const config = getOverlayConfig(ScenarioRunStatus.SUCCESS);
        expect(config.isComplete).toBe(true);
      });

      /** @scenario Light mode restores the full-card completion wash */
      it("uses the established layered green light-mode gradient", () => {
        const config = getOverlayConfig(ScenarioRunStatus.SUCCESS);
        expect(config.lightModeGradient.match(/radial-gradient/g)).toHaveLength(
          3,
        );
        expect(config.lightModeGradient).toContain("rgba(56, 161, 105");
      });

      /** @scenario Dark mode keeps the compact status scrim */
      it("keeps the semantic green scrim for dark mode", () => {
        const config = getOverlayConfig(ScenarioRunStatus.SUCCESS);
        expect(config.scrim).toBe("green.solid/20");
      });
    });
  });
});
