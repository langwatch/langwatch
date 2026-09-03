/**
 * The remembered scope is shared state with the application still serving most
 * of the product from the same origin, so the key names AND the encoding are a
 * contract rather than an implementation detail: a slug written unquoted here
 * reads as "nothing remembered" over there, and the two halves of one product
 * then disagree about which project the reader is in.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  broadcastUiScopeWrite,
  readUiScopeMemory,
  UI_SELECTED_ORGANIZATION_ID_KEY,
  UI_SELECTED_PROJECT_SLUG_KEY,
  UI_SELECTED_TEAM_ID_KEY,
  writeUiScopeSelection,
} from "../src/behavior/ui-scope-storage";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("given the keys the application already writes", () => {
  it("names them exactly", () => {
    expect(UI_SELECTED_ORGANIZATION_ID_KEY).toBe("selectedOrganizationId");
    expect(UI_SELECTED_TEAM_ID_KEY).toBe("selectedTeamId");
    expect(UI_SELECTED_PROJECT_SLUG_KEY).toBe("selectedProjectSlug");
  });
});

describe("given a selection stored by the application", () => {
  describe("when this package reads it back", () => {
    it("reads the JSON-encoded string the application's storage hook writes", () => {
      window.localStorage.setItem(UI_SELECTED_ORGANIZATION_ID_KEY, JSON.stringify("org-acme"));
      window.localStorage.setItem(UI_SELECTED_TEAM_ID_KEY, JSON.stringify("team-shared"));
      window.localStorage.setItem(UI_SELECTED_PROJECT_SLUG_KEY, JSON.stringify("acme-app"));

      expect(readUiScopeMemory(window.localStorage)).toEqual({
        selection: {
          organizationId: "org-acme",
          teamId: "team-shared",
          projectSlug: "acme-app",
        },
      });
    });

    it("reads nothing from a value that is not a stored string", () => {
      window.localStorage.setItem(UI_SELECTED_PROJECT_SLUG_KEY, "acme-app");
      window.localStorage.setItem(UI_SELECTED_TEAM_ID_KEY, "{ not json");

      const memory = readUiScopeMemory(window.localStorage);

      expect(memory.selection.projectSlug).toBe("");
      expect(memory.selection.teamId).toBe("");
    });

    it("reads nothing when nothing was ever stored", () => {
      expect(readUiScopeMemory(window.localStorage)).toEqual({
        selection: { organizationId: "", teamId: "", projectSlug: "" },
      });
    });
  });
});

describe("given a resolution that asked for its selection to be remembered", () => {
  describe("when the writes are performed", () => {
    it("stores each one where the application will read it, encoded the same way", () => {
      writeUiScopeSelection({
        writes: [
          { key: "organizationId", value: "org-acme" },
          { key: "teamId", value: "team-shared" },
          { key: "projectSlug", value: "acme-app" },
        ],
        storage: window.localStorage,
      });

      expect(window.localStorage.getItem(UI_SELECTED_ORGANIZATION_ID_KEY)).toBe('"org-acme"');
      expect(window.localStorage.getItem(UI_SELECTED_TEAM_ID_KEY)).toBe('"team-shared"');
      expect(window.localStorage.getItem(UI_SELECTED_PROJECT_SLUG_KEY)).toBe('"acme-app"');
    });

    it("tells the document about each key, so the application's readers see it without a reload", () => {
      const broadcast = vi.fn<(key: string) => void>();

      writeUiScopeSelection({
        writes: [
          { key: "teamId", value: "team-shared" },
          { key: "projectSlug", value: "acme-app" },
        ],
        storage: window.localStorage,
        broadcast,
      });

      expect(broadcast.mock.calls.map(([key]) => key)).toEqual([
        UI_SELECTED_TEAM_ID_KEY,
        UI_SELECTED_PROJECT_SLUG_KEY,
      ]);
    });

    it("writes nothing at all when the resolution asked for nothing", () => {
      const setItem = vi.spyOn(Storage.prototype, "setItem");

      writeUiScopeSelection({ writes: [], storage: window.localStorage });

      expect(setItem).not.toHaveBeenCalled();
    });
  });

  describe("when the document is told", () => {
    it("broadcasts the event the application's storage hook listens for", () => {
      const seen: string[] = [];
      const listener = (event: Event) => seen.push((event as StorageEvent).key ?? "");
      window.addEventListener("local-storage", listener);

      broadcastUiScopeWrite(UI_SELECTED_PROJECT_SLUG_KEY);
      window.removeEventListener("local-storage", listener);

      expect(seen).toEqual([UI_SELECTED_PROJECT_SLUG_KEY]);
    });
  });
});
