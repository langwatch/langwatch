/**
 * @vitest-environment jsdom
 *
 * Unit tests for the useNewScenarioFlow hook.
 *
 * Covers:
 * - Show welcome modal on first scenario creation (no scenarios, not seen before)
 * - Proceed from welcome modal to scenario creation (persists welcomeSeen)
 * - Skip welcome modal when scenarios already exist
 * - Skip welcome modal when already seen (localStorage)
 * - Dismiss welcome modal via onOpenChange
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useNewScenarioFlow } from "../useNewScenarioFlow";

const WELCOME_SEEN_KEY = "langwatch:scenarios:welcomeSeen";

describe("useNewScenarioFlow()", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe("when no scenarios exist and welcome not yet seen", () => {
    it("shows welcome modal on handleNewScenario", () => {
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

    it("persists welcomeSeen in localStorage after proceeding", () => {
      const { result } = renderHook(() =>
        useNewScenarioFlow({ scenarioCount: 0, isLoading: false })
      );

      act(() => {
        result.current.handleNewScenario();
      });

      act(() => {
        result.current.handleWelcomeProceed();
      });

      expect(localStorage.getItem(WELCOME_SEEN_KEY)).toBe("true");
    });
  });

  describe("when no scenarios exist but welcome already seen", () => {
    it("opens create modal directly on handleNewScenario", () => {
      localStorage.setItem(WELCOME_SEEN_KEY, "true");

      const { result } = renderHook(() =>
        useNewScenarioFlow({ scenarioCount: 0, isLoading: false })
      );

      act(() => {
        result.current.handleNewScenario();
      });

      expect(result.current.showCreateModal).toBe(true);
      expect(result.current.showWelcome).toBe(false);
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
    it("opens create modal instead of welcome modal", () => {
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

  describe("when dismissing the welcome modal via onOpenChange", () => {
    it("closes the welcome modal", () => {
      const { result } = renderHook(() =>
        useNewScenarioFlow({ scenarioCount: 0, isLoading: false })
      );

      act(() => {
        result.current.handleNewScenario();
      });

      expect(result.current.showWelcome).toBe(true);

      act(() => {
        result.current.handleWelcomeOpenChange(false);
      });

      expect(result.current.showWelcome).toBe(false);
    });
  });
});
