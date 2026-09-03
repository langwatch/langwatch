/**
 * `openPlatformDrawer` writes the same address `openDrawer` does, including
 * its clearing of every stale `drawer.*` key — a leftover one opens an editor
 * on the row the reader looked at before this one.
 *
 * Spec: specs/ai-governance/cli-onboarding/login-unified.feature
 */

import { describe, expect, it, vi } from "vitest";
import { DRAWER_OPEN_PARAM } from "../src/features/drawers";
import { openPlatformDrawer } from "../src/features/api-key/behavior/api-key-platform-drawer";

describe("given a screen addresses the create-project drawer", () => {
  describe("when nothing else is open", () => {
    it("writes the address the rest of the product produces for it", () => {
      const setQuery = vi.fn();
      openPlatformDrawer({
        query: {},
        drawer: "createProject",
        params: { organizationId: "org_1" },
        openParam: DRAWER_OPEN_PARAM,
        setQuery,
      });
      expect(setQuery).toHaveBeenCalledWith({
        [DRAWER_OPEN_PARAM]: "createProject",
        "drawer.organizationId": "org_1",
      });
    });
  });

  describe("when another drawer left its parameters behind", () => {
    it("drops every one of them and keeps everything else", () => {
      const setQuery = vi.fn();
      openPlatformDrawer({
        query: {
          [DRAWER_OPEN_PARAM]: "llmModelCost",
          "drawer.id": "cost_9",
          scope: "TEAM:team_1",
        },
        drawer: "createProject",
        openParam: DRAWER_OPEN_PARAM,
        setQuery,
      });
      expect(setQuery).toHaveBeenCalledWith({
        scope: "TEAM:team_1",
        [DRAWER_OPEN_PARAM]: "createProject",
      });
    });

    it("leaves out a parameter with no value rather than writing undefined", () => {
      const setQuery = vi.fn();
      openPlatformDrawer({
        query: {},
        drawer: "createProject",
        params: { organizationId: void 0 },
        openParam: DRAWER_OPEN_PARAM,
        setQuery,
      });
      expect(setQuery).toHaveBeenCalledWith({ [DRAWER_OPEN_PARAM]: "createProject" });
    });
  });
});
