/**
 * The dashboard widget REST family over the real dashboard application and its memory
 * repositories: a definition the widget schema refuses is refused at the door and never stored.
 * @see modules/dashboard/specs/dashboard-widget-validation.feature
 * @vitest-environment node
 */
import { CURATED_BOARD_DEFINITIONS, templateWidgetId } from "@langwatch/analytics-catalogue";
import {
  bindMiddlewareContext,
  canonicalErrorResponse,
  createRestRuntime,
} from "@langwatch/api/rest";
import { PermissionDeniedError } from "@langwatch/authorization";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it } from "vitest";

import { createDashboardTestApp } from "../../app/__tests__/dashboard.fixture.ts";
import {
  dashboardWidgetCallerSource,
  dashboardWidgetRest,
  dashboardWidgetUrl,
} from "../dashboard-widget.rest.ts";

const CODE = "export default function Widget() { return null; }";
const SQL = "SELECT count() AS value FROM analytics.traces";

function queryDeclaring(parameter: { name: string; type: string; default?: unknown }) {
  return [{ name: "traces", sql: SQL, parameters: [parameter] }];
}

/** A project key; `held` names its permissions, and without it the key holds every one. */
function mountKey({ held }: { held?: readonly string[] } = {}) {
  const app = createDashboardTestApp();
  const caller = {
    actor: { type: "api_key" as const, id: "key-of-project-1" },
    scope: { tier: "project" as const, id: "project-1" },
  };
  const runtime = createRestRuntime({
    audit: { record: () => {} },
    authorization: restTestAuthorization(),
    identity: {
      // A project-tier route asks its permission of the door itself.
      authenticate: ({ permission }) => {
        if (held && !held.includes(permission)) {
          throw new PermissionDeniedError({
            permission,
            scope: { type: "project", id: "project-1" },
            denialReason: "no-grant",
          });
        }
        return caller;
      },
      identify: () => caller,
    },
  });
  const hono = runtime.mount(dashboardWidgetRest.router(), {
    app: () => app,
    middlewareContext: [
      bindMiddlewareContext(dashboardWidgetUrl, () => "https://app.langwatch.test/dashboards"),
      bindMiddlewareContext(dashboardWidgetCallerSource, () => ({ kind: "api" as const })),
    ],
    onError: canonicalErrorResponse,
  });
  const base = "/api/v1/projects/project-1/analytics/dashboard-widgets";

  const send = async ({ path = "", method = "GET", body }: SendInput = {}) => {
    const response = await hono.fetch(
      new Request(`http://api.test${base}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    const text = await response.text();

    return { status: response.status, json: text === "" ? undefined : JSON.parse(text) };
  };

  return {
    list: () => send(),
    read: (id: string) => send({ path: `/${id}` }),
    create: (body: unknown) => send({ method: "POST", body }),
    update: (id: string, body: unknown) => send({ path: `/${id}`, method: "PATCH", body }),
    remove: (id: string) => send({ path: `/${id}`, method: "DELETE" }),
  };
}

interface SendInput {
  path?: string;
  method?: string;
  body?: unknown;
}

describe("given the dashboard widget REST family", () => {
  describe("when a widget is created with an invalid parameter declaration", () => {
    /** @scenario "Creating a widget over the API refuses a reserved or prototype parameter name" */
    it.each(["dashboard_context_since", "__proto__"])(
      "refuses a parameter named %s and stores nothing",
      async (name) => {
        const key = mountKey();

        const created = await key.create({
          name: "Traces",
          code: CODE,
          queries: queryDeclaring({ name, type: "string" }),
        });
        const listed = await key.list();

        expect(created.status).toBe(422);
        expect(created.json.code).toBe("validation_error");
        expect(listed.json.data).toEqual([]);
      },
    );

    /** @scenario "Creating a widget over the API refuses a parameter default of the wrong type" */
    it("refuses a number parameter defaulting to a string and stores nothing", async () => {
      const key = mountKey();

      const created = await key.create({
        name: "Traces",
        code: CODE,
        queries: queryDeclaring({ name: "limit", type: "number", default: "oops" }),
      });
      const listed = await key.list();

      expect(created.status).toBe(422);
      expect(created.json.code).toBe("validation_error");
      expect(listed.json.data).toEqual([]);
    });
  });

  describe("when a saved widget is updated with an invalid parameter declaration", () => {
    /** @scenario "Updating a widget over the API refuses an invalid definition and keeps the stored one" */
    it("refuses the update and reads back the original definition", async () => {
      const key = mountKey();
      const queries = queryDeclaring({ name: "limit", type: "number", default: 10 });
      const created = await key.create({ name: "Traces", code: CODE, queries });

      const updated = await key.update(created.json.id, {
        code: CODE,
        queries: queryDeclaring({ name: "constructor", type: "string" }),
      });
      const read = await key.read(created.json.id);

      expect(created.status).toBe(201);
      expect(updated.status).toBe(422);
      expect(updated.json.code).toBe("validation_error");
      expect(read.json.definition.queries).toEqual(queries);
    });
  });
});

describe("given a From LangWatch board's widget", () => {
  const [board] = CURATED_BOARD_DEFINITIONS;
  const [widget] = board?.widgets ?? [];
  if (!board || !widget) throw new Error("No From LangWatch board ships a widget");
  const id = templateWidgetId({ templateId: board.templateId, key: widget.key });

  describe("when a key with analytics:view gets it by its template widget id", () => {
    /** @scenario "A From LangWatch widget is read over the API by its template widget id" */
    it("answers its name and queries from the catalogue, and refuses to change it", async () => {
      const key = mountKey({ held: ["analytics:view"] });
      const fullKey = mountKey();

      const read = await key.read(id);
      const updated = await fullKey.update(id, { name: "Mine now" });
      const removed = await fullKey.remove(id);

      expect(read.status).toBe(200);
      expect(read.json).toMatchObject({
        id,
        name: widget.name,
        definition: { queries: widget.definition.queries },
        dashboardId: null,
      });
      expect(updated.status).toBe(404);
      expect(removed.status).toBe(404);
    });
  });

  describe("when a key without analytics:view gets it", () => {
    /** @scenario "A From LangWatch widget is refused without analytics:view" */
    it("refuses the request as forbidden", async () => {
      const key = mountKey({ held: ["analytics:create", "analytics:update"] });

      const read = await key.read(id);

      expect(read.status).toBe(403);
    });
  });
});
