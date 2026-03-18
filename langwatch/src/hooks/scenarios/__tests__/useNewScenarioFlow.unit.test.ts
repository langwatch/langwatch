/**
 * @vitest-environment jsdom
 *
 * Integration tests for the useNewScenarioFlow hook.
 *
 * Covers the @integration scenarios from welcome-screens.feature:
 * - Show welcome screen on first scenario creation (no scenarios)
 * - Proceed from welcome screen to scenario creation
 * - Skip welcome screen when scenarios already exist
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useNewScenarioFlow } from "../useNewScenarioFlow";

describe("useNewScenarioFlow()", () => {
  describe("when no scenarios exist", () => {
    it("shows welcome screen on handleNewScenario", () => {
      const { result } = renderHook(() =>
        useNewScenarioFlow({ scenarioCount: 0, isLoading: false })
      );

      act(() => {
        result.current.handleNewScenario();
      });

      expect(result.current.showWelcome).toBe(true);
      expect(result.current.showCreateModal).toBe(false);
    });

    it("opens create modal after proceeding from welcome", () => {
      const { result } = renderHook(() =>
        useNewScenarioFlow({ scenarioCount: 0, isLoading: false })
      );

      act(() => {
        result.current.handleNewScenario();
      });

      act(() => {
        result.current.handleWelcomeProceed();
      });

      expect(result.current.showWelcome).toBe(false);
      expect(result.current.showCreateModal).toBe(true);
    });
  });

  describe("when scenarios exist", () => {
    it("opens create modal directly on handleNewScenario", () => {
      const { result } = renderHook(() =>
        useNewScenarioFlow({ scenarioCount: 3, isLoading: false })
      );

      act(() => {
        result.current.handleNewScenario();
      });

      expect(result.current.showCreateModal).toBe(true);
      expect(result.current.showWelcome).toBe(false);
    });
  });

  describe("when data is still loading", () => {
    it("opens create modal instead of welcome screen", () => {
      const { result } = renderHook(() =>
        useNewScenarioFlow({ scenarioCount: 0, isLoading: true })
      );

      act(() => {
        result.current.handleNewScenario();
      });

      expect(result.current.showCreateModal).toBe(true);
      expect(result.current.showWelcome).toBe(false);
    });
  });

  describe("when closing the create modal", () => {
    it("resets showCreateModal to false", () => {
      const { result } = renderHook(() =>
        useNewScenarioFlow({ scenarioCount: 3, isLoading: false })
      );

      act(() => {
        result.current.handleNewScenario();
      });

      act(() => {
        result.current.handleCloseCreateModal();
      });

      expect(result.current.showCreateModal).toBe(false);
    });
  });
});
