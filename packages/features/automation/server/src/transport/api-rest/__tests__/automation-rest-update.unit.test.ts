/**
 * @see specs/automations/authoring-drawer.feature
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import type { HandledError } from "@langwatch/handled-error";
import { Hono, type ErrorHandler, type MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import { AutomationApp, type AutomationAppDependencies } from "../../../app/automation.app";
import { createTriggerRestApp } from "../automation.api";

const storedTrigger = {
  id: "trigger_1",
  projectId: "project_1",
  name: "Nightly",
  action: "ADD_TO_ANNOTATION_QUEUE",
  actionParams: { annotators: ["user_owner"], createdByUserId: "user_owner" },
  triggerKind: "AUTOMATION",
  filterQuery: "",
  filters: { topics: ["billing"] },
  active: true,
  message: null,
  alertType: null,
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  updatedAt: new Date("2026-09-02T00:00:00.000Z"),
};

function mount(options: { realConditionRule?: boolean } = {}) {
  const updates: unknown[] = [];
  const creates: unknown[] = [];
  // The condition rule is the application's own; a suite about the rule composes the real
  // one, and a suite about anything else keeps the stub so its own subject stays alone.
  const rules = AutomationApp.create({
    automation: {
      create: vi.fn(async (command: unknown) => {
        creates.push(command);
        return storedTrigger;
      }),
    },
  } as unknown as AutomationAppDependencies);
  const app = {
    tryGetLiveById: vi.fn(async () => storedTrigger),
    assertConditionSurvivesEdit: options.realConditionRule
      ? (input: Parameters<AutomationApp["assertConditionSurvivesEdit"]>[0]) =>
          rules.assertConditionSurvivesEdit(input)
      : vi.fn(),
    createTraceAutomation: (command: unknown) =>
      rules.createTraceAutomation(command as never),
    update: vi.fn(async (command: unknown) => {
      updates.push(command);
      return storedTrigger;
    }),
  };
  const hono = new Hono().route(
    "/",
    createTriggerRestApp({
      security: projectSecurity(),
      automation: () => app as never,
      platformUrl: () => "https://app.test/automations",
    }).hono,
  );
  return {
    updates,
    creates,
    app,
    post: (body: unknown) =>
      hono.fetch(
        new Request("http://api.test/api/triggers", {
          method: "POST",
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
        }),
      ),
    patch: (body: unknown) =>
      hono.fetch(
        new Request("http://api.test/api/triggers/trigger_1", {
          method: "PATCH",
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
        }),
      ),
  };
}

/** Renders the typed refusal the way every client reads it: by code. */
const renderError: ErrorHandler = (error, c) => {
  const handled = error as Partial<HandledError>;
  return handled.code
    ? c.json({ error: handled.code }, (handled.httpStatus ?? 500) as 422)
    : c.json({ error: String(error) }, 500);
};

function projectSecurity(): AppRestSecurity {
  const noop: MiddlewareHandler = async (_c, next) => {
    await next();
  };
  const withProject: MiddlewareHandler = async (c, next) => {
    c.set("project", { id: "project_1", slug: "acme" });
    await next();
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderError,
    canonicalErrorHandler: renderError,
    authenticateProject: () => withProject,
    authorizeProjectPermission: () => noop,
    authorizeApiKeyCeiling: () => noop,
    authenticateOrganization: () => noop,
    authorizeOrganizationPermission: () => noop,
    authorizeRouteTeamPermission: () => noop,
    authorizeRouteProjectPermission: () => noop,
    authenticateOrganizationThrowing: noop,
    authorizeOrganizationPermissionThrowing: () => noop,
  } as never);
}

describe("given the REST automation edit", () => {
  describe("when the edit carries delivery settings", () => {
    // @scenario "A REST edit cannot rewrite an automation's delivery settings"
    it("refuses the edit with the invalid-action-params code and writes nothing", async () => {
      const api = mount();

      const response = await api.patch({
        actionParams: { url: "https://attacker.test/", headers: { Authorization: "secret" } },
      });

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: "invalid_action_params" });
      expect(api.app.update).not.toHaveBeenCalled();
    });

    // @scenario "A REST edit cannot re-attribute an automation to another user"
    it("refuses an edit that renames the annotation queue's creator", async () => {
      const api = mount();

      const response = await api.patch({
        actionParams: { annotators: ["user_victim"], createdByUserId: "user_victim" },
      });

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: "invalid_action_params" });
      expect(api.app.update).not.toHaveBeenCalled();
    });
  });

  describe("when the edit carries only the fields the endpoint documents", () => {
    // @scenario "A REST edit still changes an automation's name and state"
    it("applies the edit and forwards no delivery settings", async () => {
      const api = mount();

      const response = await api.patch({ name: "Renamed", active: false });

      expect(response.status).toBe(200);
      expect(api.updates).toEqual([
        { id: "trigger_1", projectId: "project_1", name: "Renamed", active: false },
      ]);
    });
  });
});

describe("given the REST automation create", () => {
  describe("when the request omits the condition entirely", () => {
    /** @scenario "The REST API no longer invents an empty condition" */
    it("refuses it with the machine-readable condition-required code", async () => {
      const api = mount();

      const response = await api.post({
        name: "No condition",
        action: "SEND_SLACK_MESSAGE",
        actionParams: { slackWebhook: "https://hooks.slack.com/services/abc" },
      });

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: "trigger_filters_required" });
      expect(api.creates).toEqual([]);
    });
  });
});

describe("given a stored automation whose condition is a filter set", () => {
  describe("when a REST patch replaces that condition with an empty one", () => {
    /** @scenario "A REST edit that empties the condition changes nothing" */
    it("refuses with the condition-required code and leaves the stored condition alone", async () => {
      const api = mount({ realConditionRule: true });

      const response = await api.patch({ filters: {} });

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: "trigger_filters_required" });
      expect(api.updates).toEqual([]);
    });
  });
});
