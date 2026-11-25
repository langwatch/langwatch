// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StartRunForm } from "../start-run-form.tsx";
import { TelemetryConsole } from "../telemetry-console.tsx";
import { fakeSim, json, wireRun, wireStatus } from "./fake-sim.ts";

describe("RunsView", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.location.hash = "";
  });

  /** @scenario The console lists runs and opens one with its rate, answers by status, Retry-After and latency */
  it("lists the runs and opens the current one with its answers, Retry-After and latency", async () => {
    fakeSim({
      routes: {
        "GET /_sim/api/status": () => json({ body: wireStatus }),
        "GET /_sim/api/runs/run-2": () => json({ body: wireRun }),
      },
    });
    render(<TelemetryConsole />);

    await waitFor(() => expect(screen.getAllByTestId("run-row")).toHaveLength(2));
    const detail = screen.getByTestId("run-detail");
    expect(within(detail).getByText("unsupported content type")).toBeTruthy();
    expect(within(detail).getByText("rate limited")).toBeTruthy();
    expect(within(detail).getByText("unavailable")).toBeTruthy();
    expect(within(detail).getByText(/Retry-After 6× \(last 2\)/u)).toBeTruthy();
    expect(within(detail).getByText("88.2 ms")).toBeTruthy();
    expect(detail.textContent).toContain("50 = 45 acked + 4 refused + 1 failed");
  });

  /** @scenario The console lists runs and opens one with its rate, answers by status, Retry-After and latency */
  it("stops the running run", async () => {
    const calls = fakeSim({
      routes: {
        "GET /_sim/api/status": () => json({ body: wireStatus }),
        "GET /_sim/api/runs/run-2": () => json({ body: wireRun }),
        "DELETE /_sim/api/runs/current": () => json({ body: { ...wireRun, state: "stopped" } }),
      },
    });
    render(<TelemetryConsole />);

    await waitFor(() => expect(screen.getAllByTestId("run-row")).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(calls.some((call) => call.method === "DELETE")).toBe(true));
  });

  it("starts a load run with only the fields load reads", async () => {
    const onStart = vi.fn(async () => undefined);
    render(<StartRunForm presets={["llm-trace", "logs"]} running={false} onStart={onStart} />);

    fireEvent.change(screen.getByLabelText("Verb"), { target: { value: "load" } });
    fireEvent.change(screen.getByLabelText("Preset"), { target: { value: "logs" } });
    fireEvent.change(screen.getByLabelText("Rate"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: /Start load/u }));

    await waitFor(() =>
      expect(onStart).toHaveBeenCalledWith({
        request: { mode: "load", preset: "logs", seed: 1, rate: 20, duration: "30s" },
      }),
    );
  });

  /** @scenario The control API starts, stops and reports a run */
  it("shows the sim's refusal when a run cannot start", async () => {
    const onStart = vi.fn(async () => {
      throw new Error("a run is already going; stop it first");
    });
    render(<StartRunForm presets={["llm-trace"]} running={false} onStart={onStart} />);
    fireEvent.click(screen.getByRole("button", { name: /Start send/u }));

    await waitFor(() => expect(screen.getByText(/already going/u)).toBeTruthy());
  });
});
