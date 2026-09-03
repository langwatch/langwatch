/**
 * What `openPlatformDrawer` writes.
 *
 * `openPlatformDrawer` is this family's single piece of drawer vocabulary. The
 * provider editor, the default-model override and the model-cost editor are all
 * addressed rather than mounted — two of them by openers outside this family —
 * so a screen names one and this function writes the address the rest of the
 * product already produces. `llmModelCost` is registered in
 * `installed-ui-drawers.ts` now; the other two are not, and
 * `dev/docs/plans/core-application-feature-extraction-plan.md` records why.
 *
 * Getting that address wrong is silent in both directions: a missing
 * `drawer.modelProviderId` opens an empty editor, and a LEFTOVER one from a
 * previous drawer opens the editor on the row the reader looked at before this
 * one. `openDrawer` clears every `drawer.*` key for exactly that reason, and
 * this has to as well.
 *
 * Spec: specs/model-providers/provider-configuration.feature
 */

import { describe, expect, it, vi } from "vitest";
import { openPlatformDrawer } from "../src/features/model-provider/behavior/model-provider-open-platform-drawer";

const DRAWER_OPEN_PARAM = "drawer.open";

describe("given a screen addressing one of the platform drawers", () => {
  it("writes the address the rest of the product produces for it", () => {
    const setQuery = vi.fn();

    openPlatformDrawer({
      drawer: "editModelProvider",
      params: { modelProviderId: "mp_1", providerKey: "openai" },
      query: {},
      drawerOpenParam: DRAWER_OPEN_PARAM,
      setQuery,
    });

    expect(setQuery).toHaveBeenCalledWith({
      [DRAWER_OPEN_PARAM]: "editModelProvider",
      "drawer.modelProviderId": "mp_1",
      "drawer.providerKey": "openai",
    });
  });

  it("drops every parameter the previously open drawer left behind", () => {
    const setQuery = vi.fn();

    openPlatformDrawer({
      drawer: "editModelProvider",
      params: { modelProviderId: "mp_1" },
      query: {
        [DRAWER_OPEN_PARAM]: "llmModelCost",
        "drawer.id": "cost_9",
        scope: "TEAM:team_1",
      },
      drawerOpenParam: DRAWER_OPEN_PARAM,
      setQuery,
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
    const setQuery = vi.fn();

    openPlatformDrawer({
      drawer: "editModelProvider",
      // No project: a provider belongs to the organization, and an
      // organization on the agent-governance track has no project at all.
      params: { projectId: void 0, organizationId: "org_1" },
      query: {},
      drawerOpenParam: DRAWER_OPEN_PARAM,
      setQuery,
    });

    expect(setQuery).toHaveBeenCalledWith({
      [DRAWER_OPEN_PARAM]: "editModelProvider",
      "drawer.organizationId": "org_1",
    });
  });

  it("addresses a drawer that takes no parameters at all", () => {
    const setQuery = vi.fn();

    openPlatformDrawer({
      drawer: "defaultModelOverride",
      query: {},
      drawerOpenParam: DRAWER_OPEN_PARAM,
      setQuery,
    });

    expect(setQuery).toHaveBeenCalledWith({
      [DRAWER_OPEN_PARAM]: "defaultModelOverride",
    });
  });
});
