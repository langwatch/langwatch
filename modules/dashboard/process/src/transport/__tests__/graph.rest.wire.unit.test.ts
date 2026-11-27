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
    audit: { record: () => {} },
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
// Literal on purpose: a constant-derived expectation would follow a regression.
const SIZE = { colSpan: 4, rowSpan: 3 };
const sizeOf = (graph: { colSpan: number; rowSpan: number }) => ({
  colSpan: graph.colSpan,
  rowSpan: graph.rowSpan,
});

describe("the graphs REST family", () => {
  describe("when a graph is posted without a size", () => {
    /** @scenario "A graph created over REST without a size lands at the grid's default of four by three" */
    it("is four columns by three rows", async () => {
      const graphs = mountedGraphs();

      const created = await graphs.create(GRAPH);

      expect({ status: created.status, size: sizeOf(created.json) }).toEqual({
        status: 201,
        size: SIZE,
      });
    });

    /** @scenario "A graph created over REST without a size lands at the grid's default of four by three" */
    it("keeps a size the caller sent", async () => {
      const graphs = mountedGraphs();

      const created = await graphs.create({ ...GRAPH, colSpan: 2, rowSpan: 2 });

      expect(sizeOf(created.json)).toEqual({ colSpan: 2, rowSpan: 2 });
    });
  });

  describe("when a graph is posted with only a width", () => {
    /** @scenario "A graph created over REST without a size lands at the grid's default of four by three" */
    it("takes the service default height, so colSpan 2 lands two by three", async () => {
      const graphs = mountedGraphs();

      const created = await graphs.create({ ...GRAPH, colSpan: 2 });

      expect({ status: created.status, size: sizeOf(created.json) }).toEqual({
        status: 201,
        size: { colSpan: 2, rowSpan: 3 },
      });
    });
  });

  describe("when a graph is posted with a size at the grid's bounds", () => {
    /** @scenario "A graph created over REST accepts the size it would default to" */
    it("accepts the default size and the grid's full bounds as input", async () => {
      const graphs = mountedGraphs();

      const atDefault = await graphs.create({ ...GRAPH, gridColumn: 4, ...SIZE });
      const fullWidth = await graphs.create({ ...GRAPH, gridColumn: 0, colSpan: 8, rowSpan: 20 });

      expect({ status: atDefault.status, size: sizeOf(atDefault.json) }).toEqual({
        status: 201,
        size: SIZE,
      });
      expect({ status: fullWidth.status, size: sizeOf(fullWidth.json) }).toEqual({
        status: 201,
        size: { colSpan: 8, rowSpan: 20 },
      });
    });
  });

  describe("when a graph is posted with a size outside the grid", () => {
    /** @scenario "A graph posted over REST with a size outside the grid is refused" */
    it.each([
      ["a fractional colSpan", { colSpan: 2.5 }],
      ["a gridRow above the grid's last row", { gridRow: 2_000_000_001 }],
      ["a span past the grid's right edge", { gridColumn: 6, colSpan: 4 }],
      ["a column the default width runs past the edge from", { gridColumn: 7 }],
    ])("refuses %s and stores nothing", async (_case, size) => {
      const graphs = mountedGraphs();

      const created = await graphs.create({ ...GRAPH, ...size });
      const listed = await graphs.list();

      expect({ status: created.status, code: created.json.code, listed: listed.json }).toEqual({
        status: 422,
        code: "validation_error",
        listed: [],
      });
    });
  });

  describe("when a graph posted without a size is read, listed and renamed", () => {
    /** @scenario "A graph created over REST without a size reads back, lists and renames at four by three" */
    it("answers four columns by three rows each time", async () => {
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
