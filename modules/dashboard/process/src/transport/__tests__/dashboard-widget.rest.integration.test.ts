/**
 * The dashboard widget REST family over the real dashboard application and its memory
 * repositories: a definition the widget schema refuses is refused at the door and never stored.
 * @see modules/dashboard/specs/dashboard-widget-validation.feature
 * @vitest-environment node
 */
import { bindRestMiddleware, canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
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

function mountKey() {
  const app = createDashboardTestApp();
  const caller = {
    actor: { type: "api_key" as const, id: "key-of-project-1" },
    scope: { tier: "project" as const, id: "project-1" },
  };
  const runtime = createRestRuntime({
    authorization: restTestAuthorization(),
    identity: { authenticate: () => caller, identify: () => caller },
  });
  const hono = runtime.mount(dashboardWidgetRest.router(), {
    app: () => app,
    facts: [
      bindRestMiddleware(dashboardWidgetUrl, () => "https://app.langwatch.test/dashboards"),
      bindRestMiddleware(dashboardWidgetCallerSource, () => ({ kind: "api" as const })),
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
