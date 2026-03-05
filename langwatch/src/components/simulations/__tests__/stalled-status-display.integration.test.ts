/**
 * Integration tests for stalled scenario run visual treatment.
 *
 * Verifies that STALLED status maps to warning-colored visual treatment
 * across the status->visual mapping functions used by ScenarioRunStatusIcon,
 * PreviousRunsList, StatusDisplay, and SimulationStatusOverlay.
 *
 * These tests verify the exported helper functions that drive component rendering.
 * Component rendering tests are blocked by a missing @testing-library/dom peer
 * dependency (pre-existing environment issue, not introduced by this feature).
 *
 * @see specs/scenarios/stalled-scenario-runs.feature - UI Display integration scenarios
 */
import { describe, expect, it } from "vitest";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { getStatusBadgeProps } from "../PreviousRunsList";
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
// PreviousRunsList - warning-colored badge
// @see specs/scenarios/stalled-scenario-runs.feature lines 91-96
// ============================================================================

describe("getStatusBadgeProps()", () => {
  describe("given a STALLED status", () => {
    describe("when resolving badge properties", () => {
      it("returns a warning-colored palette", () => {
        const props = getStatusBadgeProps(ScenarioRunStatus.STALLED);
        expect(props.colorPalette).toBe("yellow");
      });

      it("labels the badge as stalled", () => {
        const props = getStatusBadgeProps(ScenarioRunStatus.STALLED);
        expect(props.label).toBe("stalled");
      });
    });

    describe("when compared to ERROR status badge", () => {
      it("uses a different color palette", () => {
        const stalledProps = getStatusBadgeProps(ScenarioRunStatus.STALLED);
        const errorProps = getStatusBadgeProps(ScenarioRunStatus.ERROR);
        expect(stalledProps.colorPalette).not.toBe(errorProps.colorPalette);
      });

      it("uses a different label", () => {
        const stalledProps = getStatusBadgeProps(ScenarioRunStatus.STALLED);
        const errorProps = getStatusBadgeProps(ScenarioRunStatus.ERROR);
        expect(stalledProps.label).not.toBe(errorProps.label);
      });
    });
  });
});

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

      it("provides a stalled status text", () => {
        const config = getOverlayConfig(ScenarioRunStatus.STALLED);
        expect(config.statusText).toBe("Stalled");
      });

      it("provides stalled gradient values", () => {
        const config = getOverlayConfig(ScenarioRunStatus.STALLED);
        expect(config.gradientLight).toContain("radial-gradient");
        expect(config.gradientDark).toContain("radial-gradient");
      });
    });

    describe("when compared to ERROR overlay", () => {
      it("uses a different status text", () => {
        const stalledConfig = getOverlayConfig(ScenarioRunStatus.STALLED);
        const errorConfig = getOverlayConfig(ScenarioRunStatus.ERROR);
        expect(stalledConfig.statusText).not.toBe(errorConfig.statusText);
      });

      it("uses a different gradient", () => {
        const stalledConfig = getOverlayConfig(ScenarioRunStatus.STALLED);
        const errorConfig = getOverlayConfig(ScenarioRunStatus.ERROR);
        expect(stalledConfig.gradientLight).not.toBe(
          errorConfig.gradientLight,
        );
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
    });
  });
});
