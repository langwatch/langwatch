// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FaultsView } from "../faults-view.tsx";
import { fakeSim, json } from "./fake-sim.ts";

const fault = {
  id: "flt_1",
  channel: "slack-webhook",
  target: "*",
  status: 429,
  retryAfter: 1,
  latencyMs: 0,
  drop: false,
  times: 2,
};

describe("FaultsView", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  /** @scenario The console shows records, deliveries, faults and setup */
  it("lists faults, adds one and removes one", async () => {
    const calls = fakeSim({
      routes: {
        "GET /_sim/api/faults": () => json({ body: { faults: [fault] } }),
        "POST /_sim/api/faults": () => json({ body: { ...fault, id: "flt_2" }, status: 201 }),
        "DELETE /_sim/api/faults/flt_1": () => json({ body: {} }),
      },
    });
    render(<FaultsView />);
    await waitFor(() => expect(screen.getByText("429")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Target"), { target: { value: "ok" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "503" } });
    fireEvent.click(screen.getByRole("button", { name: "Add fault" }));
    await waitFor(() => expect(calls.some((call) => call.method === "POST")).toBe(true));
    expect(calls.find((call) => call.method === "POST")?.body).toMatchObject({
      channel: "webhook",
      target: "ok",
      status: 503,
      drop: false,
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(
        calls.some((call) => call.method === "DELETE" && call.path === "/_sim/api/faults/flt_1"),
      ).toBe(true),
    );
  });

  /** @scenario An invalid fault is refused */
  it("shows the sim's refusal of an invalid fault", async () => {
    fakeSim({
      routes: {
        "GET /_sim/api/faults": () => json({ body: { faults: null } }),
        "POST /_sim/api/faults": () =>
          json({ body: { error: "status: must be between 100 and 599" }, status: 422 }),
      },
    });
    render(<FaultsView />);

    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "99" } });
    fireEvent.click(screen.getByRole("button", { name: "Add fault" }));
    await waitFor(() => expect(screen.getByText(/must be between 100 and 599/u)).toBeTruthy());
  });
});
