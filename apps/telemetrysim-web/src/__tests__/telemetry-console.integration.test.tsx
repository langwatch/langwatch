// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Temporal } from "@langwatch/time";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RecentRuns } from "../recent-runs.tsx";
import { RunStatusPanel } from "../run-status-panel.tsx";
import { StartRunForm } from "../start-run-form.tsx";
import { runSchema } from "../telemetry-api.ts";
import { TelemetryConsole } from "../telemetry-console.tsx";

const wireRun = {
  mode: "load",
  preset: "llm-trace",
  seed: 7,
  endpoint: "https://app.feat-x.langwatch.localhost/api/otel",
  encoding: "protobuf",
  gzip: true,
  state: "running",
  startedAt: "2026-10-09T10:00:00Z",
  targetRate: 5,
  sent: 50,
  acked: 48,
  refused: 1,
  failed: 1,
  retried: 0,
  late: 0,
};
const run = runSchema.parse(wireRun);

const json = ({ body, status = 200 }: { body: unknown; status?: number }) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("the telemetrysim console", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the current run's counters, rate and elapsed time", () => {
    render(<RunStatusPanel run={run} now={Temporal.Instant.from("2026-10-09T10:00:10Z")} />);
    const panel = screen.getByTestId("run-status").textContent ?? "";
    expect(panel).toContain("llm-trace");
    expect(panel).toContain("48");
    expect(panel).toContain("5.0/s of 5/s");
    expect(panel).toContain("10.0s");
  });

  it("starts a load run with only the fields load reads", async () => {
    const onStart = vi.fn(async () => undefined);
    render(<StartRunForm presets={["llm-trace", "otel-logs"]} running={false} onStart={onStart} />);

    fireEvent.change(screen.getByLabelText("Verb"), { target: { value: "load" } });
    fireEvent.change(screen.getByLabelText("Preset"), { target: { value: "otel-logs" } });
    fireEvent.change(screen.getByLabelText("Rate"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: /Start load/u }));

    await waitFor(() =>
      expect(onStart).toHaveBeenCalledWith({
        request: { mode: "load", preset: "otel-logs", seed: 1, rate: 20, duration: "30s" },
      }),
    );
  });

  it("shows the sim's refusal when a run cannot start", async () => {
    const onStart = vi.fn(async () => {
      throw new Error("a run is already going; stop it first");
    });
    render(<StartRunForm presets={["llm-trace"]} running={false} onStart={onStart} />);
    fireEvent.click(screen.getByRole("button", { name: /Start send/u }));

    await waitFor(() => expect(screen.getByText(/already going/u)).toBeTruthy());
  });

  it("lists the earlier runs", () => {
    render(<RecentRuns runs={[{ ...run, state: "done", seed: 3 }]} />);
    expect(screen.getByText("done")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("reads the status and stops a running run", async () => {
    const fetch = vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, "http://telemetry.test");
      if (url.pathname === "/_sim/api/status") {
        return json({
          body: { stack: "feat-x", presets: ["llm-trace"], run: wireRun, recent: [] },
        });
      }
      if (url.pathname === "/_sim/api/runs/current" && init?.method === "DELETE") {
        return json({ body: { ...wireRun, state: "stopped" } });
      }
      return json({ body: { error: "not_found" }, status: 404 });
    });
    vi.stubGlobal("fetch", fetch);
    render(<TelemetryConsole />);

    await waitFor(() =>
      expect(screen.getByTestId("run-status").textContent).toContain("llm-trace"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/_sim/api/runs/current", { method: "DELETE" }),
    );
  });
});
