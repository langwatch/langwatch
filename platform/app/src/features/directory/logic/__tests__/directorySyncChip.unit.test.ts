import { describe, expect, it } from "vitest";
import {
  directoryConnectionsBadge,
  directorySyncChipFor,
} from "../directorySyncChip";

const source = (tone: string) => ({ status: { tone } });

describe("summarising every source into one chip", () => {
  describe("given no source at all", () => {
    it("says nothing is set up rather than that nothing is wrong", () => {
      const chip = directorySyncChipFor([]);

      expect(chip.tone).toBe("neutral");
      expect(chip.label).not.toBe(
        directorySyncChipFor([source("working")]).label,
      );
    });
  });

  describe("given one source syncing and another needing attention", () => {
    /** @scenario "One source that stopped is never summarised as working" */
    it("does not say everything is working", () => {
      const chip = directorySyncChipFor([
        source("working"),
        source("attention"),
      ]);

      expect(chip.tone).not.toBe("good");
      expect(chip.label).not.toBe(
        directorySyncChipFor([source("working")]).label,
      );
    });
  });

  describe("given one source syncing and another that has ended", () => {
    /** @scenario "One source that stopped is never summarised as working" */
    it("does not say everything is working", () => {
      const chip = directorySyncChipFor([source("working"), source("ended")]);

      expect(chip.tone).not.toBe("good");
    });
  });

  describe("given every source syncing", () => {
    it("says so", () => {
      const chip = directorySyncChipFor([source("working"), source("working")]);

      expect(chip.tone).toBe("good");
    });
  });

  describe("given a source waiting for directory changes", () => {
    it("does not infer that a waiting source has never sent a change", () => {
      const chip = directorySyncChipFor([source("waiting")]);
      const badge = directoryConnectionsBadge([
        source("working"),
        source("waiting"),
      ]);

      expect(chip).toEqual({
        label: "Waiting for directory changes",
        tone: "neutral",
        title: "Waiting for your identity provider to send a directory change.",
      });
      expect(badge).toEqual({
        count: 2,
        tone: "neutral",
        title: "2 connections, at least one waiting for directory changes.",
      });
    });
  });
});
