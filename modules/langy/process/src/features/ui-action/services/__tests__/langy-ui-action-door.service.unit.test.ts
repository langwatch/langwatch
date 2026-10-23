import type { RestResolvedProjectCredential } from "@langwatch/authorization";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { LangyRestCaller } from "@langwatch/langy-contract";
/** @see specs/langy/langy-ui-actions.feature */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { LangyUiActionCatalogService } from "../langy-ui-action-catalog.service.ts";
import { LangyUiActionDoorService } from "../langy-ui-action-door.service.ts";
import type { LangyUiActionService } from "../langy-ui-action.service.ts";

const PROJECT = {
  id: "project-1",
  name: "Demo",
  slug: "demo",
  teamId: "team-1",
  organizationId: "org-1",
  isPersonal: false,
  ownerUserId: null,
  kind: "application",
};
const SCOPED_KEY: RestResolvedProjectCredential = {
  type: "apiKey",
  apiKeyId: "key-1",
  userId: "user-1",
  organizationId: "org-1",
  ingestSourceType: null,
  ingestionTemplateId: null,
  project: PROJECT,
};

function door(options: { caller?: LangyRestCaller; allowed?: boolean; asked?: string[] }) {
  return LangyUiActionDoorService.create({
    callers: {
      getCaller: async () =>
        options.caller ?? { dark: false, projectId: PROJECT.id, userId: "user-1" },
    },
    catalog: LangyUiActionCatalogService.create(),
    authz: createApiFixture<AuthzApi>({
      hasApiKeyPermission: async ({ permission }) => {
        options.asked?.push(permission);
        return options.allowed ?? true;
      },
    }),
    actions: createApiFixture<LangyUiActionService>(),
  });
}

const dispatch = (raw: object) => ({
  actor: { type: "user" as const, id: "user-1" },
  projectId: PROJECT.id,
  credential: SCOPED_KEY,
  raw: JSON.stringify(raw),
});

describe("given the CLI's UI-action door", () => {
  describe("when the rollout is dark for the project", () => {
    /** @scenario "A project the UI-action rollout has not reached answers a bare 404" */
    it("answers dark to both the listing and the dispatch", async () => {
      const dark = door({ caller: { dark: true } });
      await expect(dark.list({ actor: null, projectId: PROJECT.id })).resolves.toEqual({
        dark: true,
      });
      await expect(dark.dispatch(dispatch({ conversationId: "c", kind: "x.y" }))).resolves.toEqual({
        dark: true,
      });
    });
  });

  describe("when the kind names no page action", () => {
    it("refuses the kind before asking about the key's ceiling", async () => {
      await expect(
        door({ allowed: false }).dispatch(
          dispatch({ conversationId: "c", kind: "nowhere.at.all" }),
        ),
      ).rejects.toMatchObject({ code: "langy_ui_action_unknown" });
    });
  });

  describe("when the key does not hold the action's permission", () => {
    it("refuses with the key's ceiling", async () => {
      await expect(
        door({ allowed: false }).dispatch(
          dispatch({ conversationId: "c", kind: "workbench.duplicateTarget", payload: {} }),
        ),
      ).rejects.toMatchObject({ code: "api_key_permission_denied" });
    });
  });

  describe("when the key does not hold workflows:manage", () => {
    /** @scenario "A key without workflows:manage cannot propose code" */
    it("refuses studio.code.propose before it reaches the page", async () => {
      const asked: string[] = [];

      await expect(
        door({ allowed: false, asked }).dispatch(
          dispatch({
            conversationId: "c",
            kind: "studio.code.propose",
            payload: { code: "x = 1", summary: "Sets x" },
          }),
        ),
      ).rejects.toMatchObject({ code: "api_key_permission_denied" });
      expect(asked).toEqual(["workflows:manage"]);
    });
  });

  describe("when it lists the catalogue", () => {
    /** @scenario "The server catalogue serves the studio.code actions" */
    it("lists the Studio code editor's kinds with their permission and no backend", async () => {
      const listed = await door({}).list({ actor: null, projectId: PROJECT.id });
      if (listed.dark) throw new Error("the rollout is open in this test");
      const studio = listed.actions
        .filter((action) => action.kind.startsWith("studio."))
        .map(({ kind, permission, backend }) => ({ kind, permission, backend }));
      expect(studio).toEqual([
        { kind: "studio.code.read", permission: "workflows:view", backend: undefined },
        { kind: "studio.code.propose", permission: "workflows:manage", backend: undefined },
      ]);
    });

    it("lists every page family's kinds with their permission", async () => {
      const listed = await door({}).list({ actor: null, projectId: PROJECT.id });
      if (listed.dark) throw new Error("the rollout is open in this test");
      expect(listed.actions.map((action) => action.kind)).toContain("workbench.duplicateTarget");
      expect(listed.actions.some((action) => action.kind.startsWith("explorer."))).toBe(true);
    });
  });
});
