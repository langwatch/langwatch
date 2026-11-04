/**
 * `--sources` on `langwatch dashboard widget add` and `update`: the trace origins each of the
 * widget's queries counts, checked here before any request. Spec:
 * modules/dashboard/specs/dashboards-v2.feature (AC200j, AC200n)
 */
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type * as DashboardsApiModule from "@/client-sdk/services/dashboards/dashboards-api.service";

const sent = vi.hoisted(() => ({ create: [] as unknown[], update: [] as unknown[] }));

vi.mock("@/client-sdk/services/dashboards/dashboards-api.service", async (importOriginal) => {
  const actual = await importOriginal<typeof DashboardsApiModule>();
  class RecordingDashboardsApiService {
    createWidget = vi.fn(async (input: unknown) => {
      sent.create.push(input);
      return { id: "w_1", name: "Turns" };
    });
    getWidget = vi.fn(async () => ({
      id: "w_1",
      name: "Turns",
      definition: { version: 1, code: "x", queries: [{ name: "turns", sql: "SELECT 1" }] },
    }));
    updateWidget = vi.fn(async (input: unknown) => {
      sent.update.push(input);
      return { id: "w_1", name: "Turns" };
    });
  }
  return { ...actual, DashboardsApiService: RecordingDashboardsApiService };
});

vi.mock("../../../utils/apiKey", () => ({
  resolveCredentials: vi.fn(async () => ({ apiKey: "k", source: "env", endpoint: "e" })),
}));

import { resolveSources, WidgetInputError } from "../definitionInput";
import { addWidgetToDashboardCommand, updateWidgetOnDashboardCommand } from "../widgets";

const CODE = "export default () => null;";
const scratch = mkdtempSync(join(tmpdir(), "langwatch-widget-sources-"));
const QUERIES_FILE = join(scratch, "queries.json");
writeFileSync(QUERIES_FILE, JSON.stringify([{ name: "turns", sql: "SELECT 1" }]));

afterAll(() => rmSync(scratch, { recursive: true, force: true }));
beforeEach(() => {
  sent.create.length = 0;
  sent.update.length = 0;
});

describe("resolveSources", () => {
  /** @scenario "AC200j Sources: the API and the CLI read and write a query's sources" */
  it("reads a comma list, trimmed, and leaves the flag out when absent", () => {
    expect(resolveSources("application, langy")).toEqual(["application", "langy"]);
    expect(resolveSources("other")).toEqual(["other"]);
    expect(resolveSources(undefined)).toBeUndefined();
  });

  /** @scenario "AC200n Sources: an unknown source is refused at every door" */
  it.each(["sometimes", "Langy", "application,toString", "__proto__", "constructor", "", " , "])(
    "refuses %j with the list of sources it takes",
    (flag) => {
      expect(() => resolveSources(flag)).toThrow(WidgetInputError);
      expect(() => resolveSources(flag)).toThrow(/application, simulation, .*, langy, other/);
    },
  );
});

describe("--sources on widget add and update", () => {
  /** @scenario "AC200j Sources: the API and the CLI read and write a query's sources" */
  it("sets the list on every query of the widget it adds", async () => {
    await addWidgetToDashboardCommand("b_1", {
      name: "Turns",
      code: CODE,
      queriesFile: QUERIES_FILE,
      sources: "langy",
    });

    expect(sent.create).toEqual([
      {
        dashboardId: "b_1",
        widget: {
          name: "Turns",
          code: CODE,
          queries: [{ name: "turns", sql: "SELECT 1", sources: ["langy"] }],
        },
      },
    ]);
  });

  /** @scenario "AC200j Sources: the API and the CLI read and write a query's sources" */
  it("on update alone, sends the widget's stored queries with the new list", async () => {
    await updateWidgetOnDashboardCommand("b_1", "w_1", { sources: "application,simulation" });

    expect(sent.update).toEqual([
      {
        dashboardId: "b_1",
        widgetId: "w_1",
        changes: {
          queries: [{ name: "turns", sql: "SELECT 1", sources: ["application", "simulation"] }],
        },
      },
    ]);
  });
});
