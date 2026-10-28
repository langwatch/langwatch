/**
 * `--langy-traces` on `langwatch dashboard widget add` and `update`: the widget's Langy traces
 * setting, sent as the origins it leaves out. Spec: modules/dashboard/specs/dashboards-v2.feature
 * (AC200j)
 */
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type * as DashboardsApiModule from "@/client-sdk/services/dashboards/dashboards-api.service";

const sent = vi.hoisted(() => ({ create: [] as unknown[], update: [] as unknown[] }));

vi.mock("@/client-sdk/services/dashboards/dashboards-api.service", async (importOriginal) => {
  const actual = await importOriginal<typeof DashboardsApiModule>();
  class RecordingDashboardsApiService {
    createWidget = vi.fn(async (input: unknown) => {
      sent.create.push(input);
      return { id: "w_1", name: "Refusals" };
    });
    updateWidget = vi.fn(async (input: unknown) => {
      sent.update.push(input);
      return { id: "w_1", name: "Refusals" };
    });
  }
  return { ...actual, DashboardsApiService: RecordingDashboardsApiService };
});

vi.mock("../../../utils/apiKey", () => ({
  resolveCredentials: vi.fn(async () => ({ apiKey: "k", source: "env", endpoint: "e" })),
}));

import { resolveLangyTraces, WidgetInputError } from "../definitionInput";
import { addWidgetToDashboardCommand, updateWidgetOnDashboardCommand } from "../widgets";

const CODE = "export default () => null;";
const scratch = mkdtempSync(join(tmpdir(), "langwatch-langy-traces-"));
const QUERIES_FILE = join(scratch, "queries.json");
writeFileSync(QUERIES_FILE, "[]");

afterEach(() => rmSync(scratch, { recursive: true, force: true }));

describe("--langy-traces", () => {
  /** @scenario "AC200j Langy setting: the API and the CLI read and write a widget's setting" */
  it("sends included as no origin left out on add, and left-out as langy on update", async () => {
    sent.create.length = 0;
    sent.update.length = 0;

    await addWidgetToDashboardCommand("b_1", {
      name: "Refusals",
      code: CODE,
      queriesFile: QUERIES_FILE,
      langyTraces: "included",
    });
    await updateWidgetOnDashboardCommand("b_1", "w_1", { langyTraces: "left-out" });

    expect(sent.create).toEqual([
      {
        dashboardId: "b_1",
        widget: { name: "Refusals", code: CODE, queries: [], excludedOrigins: [] },
      },
    ]);
    expect(sent.update).toEqual([
      { dashboardId: "b_1", widgetId: "w_1", changes: { excludedOrigins: ["langy"] } },
    ]);
    expect(resolveLangyTraces("included")).toEqual([]);
    expect(resolveLangyTraces(undefined)).toBeUndefined();
    expect(() => resolveLangyTraces("sometimes")).toThrow(WidgetInputError);
  });

  it.each(["toString", "constructor", "__proto__"])(
    "refuses %s with the friendly error, not a TypeError",
    (flag) => {
      expect(() => resolveLangyTraces(flag)).toThrow(WidgetInputError);
    },
  );
});
