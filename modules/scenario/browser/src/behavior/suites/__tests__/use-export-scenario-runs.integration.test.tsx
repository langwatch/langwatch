/**
 * The scenario run export hook: what name the downloaded file lands under.
 * @vitest-environment jsdom
 * @see specs/scenarios/scenario-run-export.feature
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../scenario-api.ts", () => ({
  api: { export: { onScenarioRunExportProgress: { useSubscription: vi.fn() } } },
}));

import { useExportScenarioRuns } from "../use-export-scenario-runs.ts";

function answerWith(headers: Record<string, string>) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("run_scenario_run_id\r\n", { status: 200, headers }));
}

function captureDownloadName(): { names: (string | null)[] } {
  const captured: { names: (string | null)[] } = { names: [] };
  Object.defineProperty(window.URL, "createObjectURL", {
    value: () => "blob:export",
    writable: true,
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    captured.names.push(this.getAttribute("download"));
  });
  return captured;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("useExportScenarioRuns", () => {
  describe("when the server names a criteria export for my-project on 2026-07-28", () => {
    /** @scenario "The file downloads with a descriptive name" */
    it("saves the file under the name the server sent", async () => {
      const filename = "my-project - Scenario Runs - 2026-07-28 - criteria.csv";
      const fetchSpy = answerWith({
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Total-Runs": "3",
      });
      const downloads = captureDownloadName();
      const { result } = renderHook(() => useExportScenarioRuns({ projectId: "my-project" }));

      act(() => result.current.startExport({ mode: "criteria" }));

      await waitFor(() => expect(downloads.names).toEqual([filename]));
      const [, init] = fetchSpy.mock.calls[0]!;
      expect(JSON.parse((init as { body: string }).body)).toEqual({
        projectId: "my-project",
        mode: "criteria",
      });
    });
  });

  describe("when the response carries no file name", () => {
    /** @scenario "The file downloads with a descriptive name" */
    it("names the file by project, date and mode itself", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-07-28T09:15:00.000Z"));
      answerWith({ "X-Total-Runs": "3" });
      const downloads = captureDownloadName();
      const { result } = renderHook(() => useExportScenarioRuns({ projectId: "my-project" }));

      act(() => result.current.startExport({ mode: "criteria" }));

      await waitFor(() =>
        expect(downloads.names).toEqual(["my-project - Scenario Runs - 2026-07-28 - criteria.csv"]),
      );
    });
  });
});
