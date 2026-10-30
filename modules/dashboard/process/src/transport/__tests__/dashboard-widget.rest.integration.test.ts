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
import { PermissionDeniedError, type Actor } from "@langwatch/authorization";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it } from "vitest";

import {
  createDashboardTestAnalytics,
  createDashboardTestApp,
} from "../../app/__tests__/dashboard.fixture.ts";
import {
  dashboardWidgetCaller,
  dashboardWidgetRest,
  dashboardWidgetUrl,
} from "../dashboard-widget.rest.ts";

const CODE = "export default function Widget() { return null; }";
const SQL = "SELECT count() AS value FROM analytics.traces";

function queryDeclaring(parameter: { name: string; type: string; default?: unknown }) {
  return [{ name: "traces", sql: SQL, parameters: [parameter] }];
}

/** A key on one app; `permits` decides each permission at the key door, as its role would. */
function mountKey({
  app = createDashboardTestApp(),
  permits = () => true,
  actor = { type: "api_key" as const, id: "key-of-project-1" },
}: {
  app?: ReturnType<typeof createDashboardTestApp>;
  permits?: (permission: string) => boolean;
  actor?: Actor;
} = {}) {
  const caller = {
    actor,
    scope: { tier: "project" as const, id: "project-1" },
  };
  const runtime = createRestRuntime({
    audit: { record: () => {} },
    authorization: restTestAuthorization(),
    identity: {
      authenticate: ({ permission }) => {
        if (!permits(permission)) {
          const scope = { type: "project" as const, id: "project-1" };
          throw new PermissionDeniedError({ permission, scope, denialReason: "no-grant" });
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
      bindMiddlewareContext(dashboardWidgetCaller, () => ({ source: { kind: "api" as const } })),
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
      expect(read.json.definition.queries).toEqual(
        queries.map((query) => ({ ...query, sources: ["application"] })),
      );
    });
  });

  describe("when a widget's query names its sources", () => {
    /** @scenario "AC200o Sources: a new widget's query counts application traces" */
    it("returns application on a created query that named none", async () => {
      const key = mountKey();

      const created = await key.create({
        name: "Traces",
        code: CODE,
        queries: [{ name: "t", sql: SQL }],
      });

      expect(created.status).toBe(201);
      expect(created.json.definition.queries[0].sources).toEqual(["application"]);
    });

    /** @scenario "AC200j Sources: the API and the CLI read and write a query's sources" */
    it("stores a picked set, keeps it through an update naming none, and null clears it", async () => {
      const key = mountKey();
      const created = await key.create({
        name: "Traces",
        code: CODE,
        queries: [{ name: "t", sql: SQL, sources: ["langy", "other"] }],
      });
      const id = created.json.id;

      const renamed = await key.update(id, { name: "Renamed" });
      const resent = await key.update(id, { queries: [{ name: "t", sql: SQL }] });
      const cleared = await key.update(id, { queries: [{ name: "t", sql: SQL, sources: null }] });
      const read = await key.read(id);

      expect(renamed.json.definition.queries[0].sources).toEqual(["langy", "other"]);
      expect(resent.json.definition.queries[0].sources).toEqual(["langy", "other"]);
      expect(cleared.status).toBe(200);
      expect(read.json.definition.queries[0]).not.toHaveProperty("sources");
    });

    /** @scenario "AC200n Sources: an unknown source is refused at every door" */
    it("refuses an unknown source on create and update, and stores nothing new", async () => {
      const key = mountKey();
      const bad = [{ name: "t", sql: SQL, sources: ["application", "langy' OR 1=1 --"] }];

      const created = await key.create({ name: "Traces", code: CODE, queries: bad });
      const good = await key.create({
        name: "Traces",
        code: CODE,
        queries: [{ name: "t", sql: SQL }],
      });
      const updated = await key.update(good.json.id, { queries: bad });
      const read = await key.read(good.json.id);

      expect(created.status).toBe(422);
      expect(created.json.code).toBe("validation_error");
      expect(updated.status).toBe(422);
      expect(read.json.definition.queries[0].sources).toEqual(["application"]);
    });
  });
});

describe("given a key whose role only views analytics", () => {
  /** @scenario "AC200j Sources: the API and the CLI read and write a query's sources" */
  it("refuses a PATCH changing a query's sources with 403 and keeps the stored list", async () => {
    const app = createDashboardTestApp();
    const editor = mountKey({ app });
    const viewer = mountKey({ app, permits: (permission) => permission === "analytics:view" });
    const created = await editor.create({
      name: "Traces",
      code: CODE,
      queries: [{ name: "traces", sql: SQL }],
    });

    const patched = await viewer.update(created.json.id, {
      queries: [{ name: "traces", sql: SQL, sources: ["langy"] }],
    });
    const read = await editor.read(created.json.id);

    expect(patched.status).toBe(403);
    expect(read.json.definition.queries[0].sources).toEqual(["application"]);
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
      const key = mountKey({ permits: (permission) => permission === "analytics:view" });
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
      const key = mountKey({
        permits: (permission) => ["analytics:create", "analytics:update"].includes(permission),
      });

      const read = await key.read(id);

      expect(read.status).toBe(403);
    });
  });
});

describe("given a person's CLI access token naming a project in a widget", () => {
  const person: Actor = { type: "user", id: "user-1" };
  const named = [{ name: "traces", sql: SQL, projects: ["project-2"] }];

  function appAsking() {
    const asked: unknown[] = [];
    const app = createDashboardTestApp({
      dependencies: {
        analytics: createDashboardTestAnalytics({
          assertProjectsReadable: async (input) => void asked.push(input),
        }),
      },
    });

    return { app, asked };
  }

  /** @scenario "AC210c Compatibility: a write naming a project that does not exist, lies in another organization or cannot be read is refused alike" */
  it("is judged as that person on create, as on update", async () => {
    const { app, asked } = appAsking();
    const key = mountKey({ app, actor: person });

    const created = await key.create({ name: "Traces", code: CODE, queries: named });
    await key.update(created.json.id, { queries: named });

    expect(asked).toEqual([
      { userId: "user-1", projectIds: ["project-2"], anchorProjectId: "project-1" },
      { userId: "user-1", projectIds: ["project-2"], anchorProjectId: "project-1" },
    ]);
  });
});
