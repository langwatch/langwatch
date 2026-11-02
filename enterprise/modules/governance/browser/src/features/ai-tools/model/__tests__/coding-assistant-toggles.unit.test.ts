import { describe, expect, it } from "vitest";

import { lockedToggles, togglesOnKindChange } from "../coding-assistant-toggles.ts";

describe("coding-assistant toggles", () => {
  describe("when an admin picks pi as a tile's kind", () => {
    /** @scenario "An admin picking pi in the tile drawer gets the virtual key and bundled plan switched off" */
    it("switches the virtual key and the bundled plan off", () => {
      expect(togglesOnKindChange({ from: "codex", to: "pi" })).toEqual({
        allowVk: false,
        bundledPlan: false,
      });
    });

    it("keeps the virtual key locked off for an opened or saved pi tile", () => {
      expect(lockedToggles("pi")).toEqual({ allowVk: false });
    });
  });

  describe("when an admin moves a tile from pi to another kind", () => {
    /** @scenario "Moving a tile off a kind that fixes toggles switches them back on" */
    it("switches the virtual key and the bundled plan back on", () => {
      expect(togglesOnKindChange({ from: "pi", to: "codex" })).toEqual({
        allowVk: true,
        bundledPlan: true,
      });
    });

    it("still locks what the new kind fixes", () => {
      expect(togglesOnKindChange({ from: "pi", to: "cursor" })).toEqual({
        allowVk: true,
        bundledPlan: true,
        allowOtelDirect: false,
      });
    });
  });

  describe("when an admin picks Cursor", () => {
    it("locks direct OTLP off and leaves the bundled plan alone", () => {
      expect(togglesOnKindChange({ from: "codex", to: "cursor" })).toEqual({
        allowOtelDirect: false,
      });
    });
  });

  describe("when an admin moves a tile from Cursor to another kind", () => {
    /** @scenario "Moving a tile off a kind that fixes toggles switches them back on" */
    it("switches direct OTLP back on", () => {
      expect(togglesOnKindChange({ from: "cursor", to: "codex" })).toEqual({
        allowOtelDirect: true,
      });
    });
  });

  describe("when an admin moves between kinds with no fixed toggles", () => {
    it("changes nothing the admin set", () => {
      expect(togglesOnKindChange({ from: "codex", to: "claude_code" })).toEqual({});
    });
  });
});
