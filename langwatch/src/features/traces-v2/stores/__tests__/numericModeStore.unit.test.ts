// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  selectNumericModesFor,
  useNumericModeStore,
} from "../numericModeStore";

const PROJECT = "proj-1";
const STORAGE_KEY = "langwatch:traces-v2:numeric-mode:v1:proj-1";

describe("numericModeStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useNumericModeStore.setState({ byProject: {} });
  });

  describe("given a fresh store", () => {
    it("has no overrides for a project", () => {
      expect(
        selectNumericModesFor({
          state: useNumericModeStore.getState(),
          projectId: PROJECT,
        }),
      ).toEqual({});
    });

    it("returns a stable empty reference for a null/undefined project", () => {
      const a = selectNumericModesFor({
        state: useNumericModeStore.getState(),
        projectId: null,
      });
      const b = selectNumericModesFor({
        state: useNumericModeStore.getState(),
        projectId: undefined,
      });
      expect(a).toBe(b);
    });
  });

  describe("when a mode is set", () => {
    it("stores the override under the project", () => {
      useNumericModeStore
        .getState()
        .setMode({ projectId: PROJECT, field: "spans", mode: "range" });
      expect(
        selectNumericModesFor({
          state: useNumericModeStore.getState(),
          projectId: PROJECT,
        }).spans,
      ).toBe("range");
    });

    it("persists to localStorage and reloads via hydrate", () => {
      useNumericModeStore
        .getState()
        .setMode({ projectId: PROJECT, field: "promptVersion", mode: "range" });
      // Wipe in-memory state, keep localStorage, re-hydrate (reload sim).
      useNumericModeStore.setState({ byProject: {} });
      useNumericModeStore.getState().hydrateFromStorage(PROJECT);
      expect(
        selectNumericModesFor({
          state: useNumericModeStore.getState(),
          projectId: PROJECT,
        }).promptVersion,
      ).toBe("range");
    });

    it("keeps projects isolated", () => {
      useNumericModeStore
        .getState()
        .setMode({ projectId: PROJECT, field: "spans", mode: "range" });
      useNumericModeStore
        .getState()
        .setMode({ projectId: "proj-2", field: "spans", mode: "discrete" });
      expect(
        selectNumericModesFor({
          state: useNumericModeStore.getState(),
          projectId: PROJECT,
        }).spans,
      ).toBe("range");
      expect(
        selectNumericModesFor({
          state: useNumericModeStore.getState(),
          projectId: "proj-2",
        }).spans,
      ).toBe("discrete");
    });
  });

  describe("when stored data is malformed", () => {
    it("ignores non-mode values on hydrate", () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: 1,
          modes: { spans: "bogus", promptVersion: "discrete" },
        }),
      );
      useNumericModeStore.getState().hydrateFromStorage(PROJECT);
      const modes = selectNumericModesFor({
        state: useNumericModeStore.getState(),
        projectId: PROJECT,
      });
      expect(modes.spans).toBeUndefined();
      expect(modes.promptVersion).toBe("discrete");
    });

    it("ignores a wrong storage version", () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: 2, modes: { spans: "range" } }),
      );
      useNumericModeStore.getState().hydrateFromStorage(PROJECT);
      expect(
        selectNumericModesFor({
          state: useNumericModeStore.getState(),
          projectId: PROJECT,
        }).spans,
      ).toBeUndefined();
    });
  });
});
