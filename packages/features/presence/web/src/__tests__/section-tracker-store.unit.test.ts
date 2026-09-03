import { beforeEach, describe, expect, it } from "vitest";
import { selectMostVisibleSection, useSectionTrackerStore } from "../section-tracker-store";

beforeEach(() => {
  useSectionTrackerStore.getState().reset();
});

describe("given the section tracker store", () => {
  describe("when no section has been registered", () => {
    it("reports no most-visible section", () => {
      expect(selectMostVisibleSection(useSectionTrackerStore.getState())).toBeNull();
    });
  });

  describe("when a section's ratio is at or below the 10% noise floor", () => {
    it("does not surface it as most visible", () => {
      useSectionTrackerStore.getState().setVisibility("input", 0.1);
      expect(selectMostVisibleSection(useSectionTrackerStore.getState())).toBeNull();
    });
  });

  describe("when multiple sections are visible", () => {
    it("picks the section with the highest ratio", () => {
      useSectionTrackerStore.getState().setVisibility("input", 0.3);
      useSectionTrackerStore.getState().setVisibility("output", 0.8);
      useSectionTrackerStore.getState().setVisibility("evals", 0.5);

      expect(selectMostVisibleSection(useSectionTrackerStore.getState())).toBe("output");
    });
  });

  describe("when a section's ratio drops to zero", () => {
    it("deregisters that section entirely", () => {
      useSectionTrackerStore.getState().setVisibility("input", 0.6);
      useSectionTrackerStore.getState().setVisibility("input", 0);

      expect(useSectionTrackerStore.getState().visibility.has("input")).toBe(false);
    });
  });

  describe("when a section is explicitly unregistered", () => {
    it("removes it even while still visible", () => {
      useSectionTrackerStore.getState().setVisibility("input", 0.6);
      useSectionTrackerStore.getState().unregister("input");

      expect(useSectionTrackerStore.getState().visibility.has("input")).toBe(false);
    });
  });
});
