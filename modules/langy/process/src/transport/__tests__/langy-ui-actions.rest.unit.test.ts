import {
  canonicalErrorResponse,
  createRestRuntime,
  recordProjectCredential,
} from "@langwatch/api/rest";
import type {
  LangyApi,
  LangyUiActionDispatchInput,
  LangyUiActionsListed,
} from "@langwatch/langy-contract";
/** @see specs/langy/langy-ui-actions.feature */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { langyProcessModule } from "../../langy.module.ts";
import { langyUiActionsRest } from "../langy-ui-actions.rest.ts";

const PROJECT_ID = "project-1";
const PROJECT = {
  id: PROJECT_ID,
  name: "Demo",
  slug: "demo",
  teamId: "team-1",
  organizationId: "org-1",
  isPersonal: false,
  ownerUserId: null,
};
const LISTED: LangyUiActionsListed = {
  dark: false,
  actions: [
    {
      kind: "workbench.duplicateTarget",
      permission: "experiments:update",
      backend: "transform",
      payloadSchema: { type: "object" },
    },
  ],
};

function buildDoor(options: { dark?: boolean } = {}) {
  const dispatched: LangyUiActionDispatchInput[] = [];
  const identify = (input: { request: Request }) => {
    recordProjectCredential(input.request, { type: "legacyProjectKey", project: PROJECT });
    return { actor: { type: "user" as const, id: "user-1" }, scope: null, permission: null };
  };
  const authenticate = () => {
    throw new Error("the UI-action door opens without a permission, deferred to the action");
  };
  const app = createApiFixture<LangyApi>({
    listUiActions: async () => (options.dark ? { dark: true } : LISTED),
    dispatchUiAction: async (input) => {
      dispatched.push(input);
      return options.dark
        ? { dark: true }
        : { dark: false, outcome: { executedVia: "browser", result: { ok: true } } };
    },
  });
  const hono = createRestRuntime({ identity: { authenticate, identify } }).mount(
    langyUiActionsRest.router(),
    { app: () => app, onError: (error, context) => canonicalErrorResponse(error, context) },
  );
  const url = "http://api.test/api/langy/ui/actions";
  return {
    dispatched,
    list: () => hono.request(url),
    dispatch: (body: unknown) =>
      hono.request(url, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      }),
  };
}

describe("given the langy module installed in the api process", () => {
  describe("when the process mounts its REST families", () => {
    /** @scenario "The CLI's UI-action door is served where main served it" */
    it("declares the UI-action door among langy's transports", () => {
      expect(langyProcessModule.transports).toContain(langyUiActionsRest);
    });
  });
});

describe("given a worker's session key on a project the rollout reached", () => {
  describe("when it lists the UI actions", () => {
    /** @scenario "The CLI's UI-action door is served where main served it" */
    it("answers the catalogue langy lists", async () => {
      const response = await buildDoor().list();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ actions: LISTED.dark ? [] : LISTED.actions });
    });
  });

  describe("when it dispatches one", () => {
    /** @scenario "The CLI's UI-action door is served where main served it" */
    it("hands the raw body and the project to langy, and answers its outcome", async () => {
      const door = buildDoor();
      const body = { conversationId: "conv-1", kind: "workbench.duplicateTarget", payload: {} };
      const response = await door.dispatch(body);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ executedVia: "browser", result: { ok: true } });
      expect(door.dispatched[0]).toMatchObject({
        projectId: PROJECT_ID,
        raw: JSON.stringify(body),
      });
    });
  });
});

describe("given a project the UI-action rollout has not reached", () => {
  /** @scenario "A project the UI-action rollout has not reached answers a bare 404" */
  it("answers a plain 404 to both the listing and the dispatch", async () => {
    const door = buildDoor({ dark: true });
    const listed = await door.list();
    const dispatched = await door.dispatch({ conversationId: "c", kind: "workbench.x" });
    expect([listed.status, await listed.text()]).toEqual([404, "404 Not Found"]);
    expect([dispatched.status, await dispatched.text()]).toEqual([404, "404 Not Found"]);
  });
});
