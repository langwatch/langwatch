/**
 * @vitest-environment node
 * The `/api/graphs` wire: the size a graph posted without one lands at, and that
 * it reads back, lists and renames at that size. Spec: dashboard-service.feature.
 */
import { canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it } from "vitest";

import { createDashboardTestApp } from "../../app/__tests__/dashboard.fixture.ts";
import { graphRest } from "../graph.rest.ts";

const PROJECT_ID = "project-1";

/** The graphs REST family over the real application and its memory repositories. */
function mountedGraphs() {
  const app = createDashboardTestApp();
  const caller = {
    actor: { type: "api_key" as const, id: "key-1" },
    scope: { tier: "project" as const, id: PROJECT_ID },
  };
  const runtime = createRestRuntime({
    authorization: restTestAuthorization(),
    identity: { authenticate: () => caller, identify: () => caller },
  });
  const hono = runtime.mount(graphRest.router(), {
    app: () => app,
    middlewareContext: [],
    onError: canonicalErrorResponse,
  });
  const send = async ({
    path = "",
    method = "GET",
    body,
  }: {
    path?: string;
    method?: string;
    body?: unknown;
  } = {}) => {
    const response = await hono.fetch(
      new Request(`http://api.test/api/graphs${path}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    const text = await response.text();

    return { status: response.status, json: text === "" ? undefined : JSON.parse(text) };
  };

  return {
    app,
    create: (body: unknown) => send({ method: "POST", body }),
    read: (id: string) => send({ path: `/${id}` }),
    list: () => send(),
    rename: (id: string, name: string) => send({ path: `/${id}`, method: "PATCH", body: { name } }),
  };
}

const GRAPH = { name: "Latency", graph: { graphType: "line" } };
const SIZE = { colSpan: 1, rowSpan: 1 };
const sizeOf = (graph: { colSpan: number; rowSpan: number }) => ({
  colSpan: graph.colSpan,
  rowSpan: graph.rowSpan,
});

describe("the graphs REST family", () => {
  describe("when a graph is posted without a size", () => {
    /** @scenario "A graph created over REST without a size is 1 by 1, as on main" */
    it("is one column by one row", async () => {
      const graphs = mountedGraphs();

      const created = await graphs.create(GRAPH);

      expect({ status: created.status, size: sizeOf(created.json) }).toEqual({
        status: 201,
        size: SIZE,
      });
    });

    /** @scenario "A graph created over REST without a size is 1 by 1, as on main" */
    it("keeps a size the caller sent", async () => {
      const graphs = mountedGraphs();

      const created = await graphs.create({ ...GRAPH, colSpan: 2, rowSpan: 2 });

      expect(sizeOf(created.json)).toEqual({ colSpan: 2, rowSpan: 2 });
    });
  });

  describe("when a graph posted without a size is read, listed and renamed", () => {
    /** @scenario "A graph created over REST without a size reads back, lists and renames at 1 by 1" */
    it("answers one column by one row each time", async () => {
      const graphs = mountedGraphs();
      const created = await graphs.create(GRAPH);

      const read = await graphs.read(created.json.id);
      const listed = await graphs.list();
      const renamed = await graphs.rename(created.json.id, "Errors");

      expect({
        read: sizeOf(read.json),
        listed: listed.json.map(sizeOf),
        renamed: { name: renamed.json.name, ...sizeOf(renamed.json) },
      }).toEqual({
        read: SIZE,
        listed: [SIZE],
        renamed: { name: "Errors", ...SIZE },
      });
    });
  });
});
