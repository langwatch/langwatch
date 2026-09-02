/**
 * What the Model Provider host answers, and — the part worth a test — what it
 * writes.
 *
 * Most of the port is a value object over readings the provider already made, so
 * the assertions below concentrate on the one method that composes something:
 * `openPlatformDrawer`, this family's single piece of platform vocabulary. The
 * provider editor, the default-model override and the model-cost editor are all
 * still `platform/app`'s registered drawers — two of them with openers outside
 * this family — so a screen names one and this adapter writes the address the
 * rest of the product already produces.
 *
 * Getting that address wrong is silent in both directions: a missing
 * `drawer.modelProviderId` opens an empty editor, and a LEFTOVER one from a
 * previous drawer opens the editor on the row the reader looked at before this
 * one. `openDrawer` clears every `drawer.*` key for exactly that reason, and
 * this adapter has to as well.
 *
 * Spec: specs/model-providers/provider-configuration.feature
 */

import { describe, expect, it, vi } from "vitest";
import {
  DRAWER_OPEN_PARAM,
  UiModelProviderHost,
} from "../src/features/model-provider/behavior/model-provider-host.adapter";

function hostWith(query: Record<string, string | undefined>) {
  const setQuery = vi.fn();
  const host = UiModelProviderHost.create(
    {
      scope: { organizationId: "org_1", teamId: "team_1", projectId: "project_1" },
      availableScopes: { organization: null, teams: [], projects: [] },
      route: { params: {}, query },
    },
    {
      hasPermission: (permission) => permission === "project:manage",
      setQuery,
      succeeded: vi.fn(),
      failed: vi.fn(),
    },
  );
  return { host, setQuery };
}

describe("given the Model Provider host", () => {
  describe("when a screen addresses one of the platform drawers", () => {
    it("writes the address the rest of the product produces for it", () => {
      const { host, setQuery } = hostWith({});

      host.openPlatformDrawer({
        drawer: "editModelProvider",
        params: { modelProviderId: "mp_1", providerKey: "openai" },
      });

      expect(setQuery).toHaveBeenCalledWith({
        [DRAWER_OPEN_PARAM]: "editModelProvider",
        "drawer.modelProviderId": "mp_1",
        "drawer.providerKey": "openai",
      });
    });

    it("drops every parameter the previously open drawer left behind", () => {
      const { host, setQuery } = hostWith({
        [DRAWER_OPEN_PARAM]: "llmModelCost",
        "drawer.id": "cost_9",
        scope: "TEAM:team_1",
      });

      host.openPlatformDrawer({
        drawer: "editModelProvider",
        params: { modelProviderId: "mp_1" },
      });

      // The stale `drawer.id` is gone and the page's own `?scope=` survives:
      // clearing everything would also throw away the filter the reader set.
      expect(setQuery).toHaveBeenCalledWith({
        scope: "TEAM:team_1",
        [DRAWER_OPEN_PARAM]: "editModelProvider",
        "drawer.modelProviderId": "mp_1",
      });
    });

    it("omits a parameter with no value rather than writing an empty one", () => {
      const { host, setQuery } = hostWith({});

      host.openPlatformDrawer({
        drawer: "editModelProvider",
        // No project: a provider belongs to the organization, and an
        // organization on the agent-governance track has no project at all.
        params: { projectId: void 0, organizationId: "org_1" },
      });

      expect(setQuery).toHaveBeenCalledWith({
        [DRAWER_OPEN_PARAM]: "editModelProvider",
        "drawer.organizationId": "org_1",
      });
    });

    it("addresses a drawer that takes no parameters at all", () => {
      const { host, setQuery } = hostWith({});

      host.openPlatformDrawer({ drawer: "defaultModelOverride" });

      expect(setQuery).toHaveBeenCalledWith({
        [DRAWER_OPEN_PARAM]: "defaultModelOverride",
      });
    });
  });

  describe("when a screen asks whether a failure was already reported", () => {
    it("says no, because nothing above a package-served screen reports one", () => {
      const { host } = hostWith({});

      expect(host.isReportedGlobally(new Error("boom"))).toBe(false);
    });
  });

  describe("when a screen asks about a grant", () => {
    it("answers the application's own reading, fail-closed", () => {
      const { host } = hostWith({});

      expect(host.hasPermission("project:manage")).toBe(true);
      expect(host.hasPermission("organization:view")).toBe(false);
    });
  });
});
