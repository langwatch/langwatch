// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { McpConsole } from "../mcp-console.tsx";
import { fakeSim, json, wireRun, wireStatus } from "./fake-sim.ts";

describe("RunsView", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.location.hash = "";
  });

  /** @scenario "An operator reads a failed run in the console" */
  it("opens a failed run with its failed check, load stats and steps", async () => {
    fakeSim({
      routes: {
        "GET /_sim/api/status": () => json({ body: wireStatus }),
        "GET /_sim/api/runs/run-2": () => json({ body: wireRun }),
      },
    });
    render(<McpConsole />);

    await waitFor(() => expect(screen.getAllByTestId("run-row")).toHaveLength(1));
    const detail = await screen.findByTestId("run-detail");
    await waitFor(() => expect(within(detail).getByText("no dropped streams")).toBeTruthy());
    expect(within(detail).getByText("stream dropped after 12s")).toBeTruthy();
    expect(
      within(detail)
        .getAllByTestId("check-result")
        .map((el) => el.textContent),
    ).toEqual(["pass", "fail"]);
    expect(within(detail).getByText("88.2 ms")).toBeTruthy();
    expect(within(detail).getByText("service unavailable")).toBeTruthy();
    expect(within(detail).getByText("503")).toBeTruthy();
  });

  /** @scenario "An operator starts a run from the console" */
  it("starts a connect run with the chosen flow and transport", async () => {
    const calls = fakeSim({
      routes: {
        "GET /_sim/api/status": () => json({ body: wireStatus }),
        "GET /_sim/api/runs/run-2": () => json({ body: wireRun }),
        "POST /_sim/api/runs": () => json({ body: wireRun, status: 202 }),
      },
    });
    render(<McpConsole />);

    await waitFor(() => expect(screen.getAllByTestId("run-row")).toHaveLength(1));
    fireEvent.change(screen.getByLabelText("Transport"), { target: { value: "both" } });
    fireEvent.click(screen.getByRole("button", { name: "connect" }));

    await waitFor(() => expect(calls.some((call) => call.method === "POST")).toBe(true));
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      scenario: "connect",
      flow: "apikey",
      client: "claude-code",
      transport: "both",
    });
  });

  /** @scenario "The console refuses a scenario setting that is not a whole number" */
  it("refuses an empty soak client count and posts nothing", async () => {
    const calls = fakeSim({
      routes: {
        "GET /_sim/api/status": () => json({ body: wireStatus }),
        "GET /_sim/api/runs/run-2": () => json({ body: wireRun }),
        "POST /_sim/api/runs": () => json({ body: wireRun, status: 202 }),
      },
    });
    render(<McpConsole />);

    await waitFor(() => expect(screen.getAllByTestId("run-row")).toHaveLength(1));
    fireEvent.change(screen.getByLabelText("Clients (soak)"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "soak" }));

    expect(await screen.findByText("Clients takes a whole number of 1 or more.")).toBeTruthy();
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  /** @scenario "The console disables a scenario the chosen flow cannot run" */
  it("disables oauth-only scenarios on the apikey flow", async () => {
    fakeSim({ routes: { "GET /_sim/api/status": () => json({ body: wireStatus }) } });
    render(<McpConsole />);

    const refresh = await screen.findByRole("button", { name: "refresh" });
    expect(refresh).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("Flow"), { target: { value: "oauth" } });
    expect(screen.getByRole("button", { name: "refresh" })).toHaveProperty("disabled", false);
  });

  /** @scenario "The console shows the approval link while an OAuth connect waits" */
  it("shows the approval link while a connect run waits", async () => {
    fakeSim({
      routes: {
        "GET /_sim/api/status": () =>
          json({
            body: {
              ...wireStatus,
              runs: [
                {
                  ...wireRun,
                  state: "waiting",
                  scenario: "oauth-connect",
                  authorizeUrl: "https://app.test/authorize?x=1",
                },
              ],
            },
          }),
      },
    });
    render(<McpConsole />);

    const banner = await screen.findByTestId("authorize-banner");
    expect(within(banner).getByRole("link").getAttribute("href")).toBe(
      "https://app.test/authorize?x=1",
    );
  });
});
