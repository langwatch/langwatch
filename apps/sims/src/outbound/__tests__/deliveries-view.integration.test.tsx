// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeliveriesView } from "../deliveries-view.tsx";
import { fakeSim, json } from "./fake-sim.ts";

const attempt = ({ n, status }: { n: number; status: number }) => ({
  id: `rec_${n}`,
  attempt: n,
  status,
  signature: "valid",
  dropped: false,
  latencyMs: 3,
  receivedAt: `2026-10-09T10:00:0${n}Z`,
});

const deliveries = [
  {
    eventId: "evt_flaky",
    target: "flaky",
    attempts: [
      attempt({ n: 1, status: 503 }),
      attempt({ n: 2, status: 503 }),
      attempt({ n: 3, status: 200 }),
    ],
  },
  { eventId: "evt_ok", target: "ok", attempts: [attempt({ n: 1, status: 200 })] },
];

describe("DeliveriesView", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  /** @scenario The console shows records, deliveries, faults and setup */
  it("groups attempts by event id and shows the timeline of the selected one", async () => {
    fakeSim({ routes: { "GET /_sim/api/deliveries": () => json({ body: { deliveries } }) } });
    render(<DeliveriesView />);

    await waitFor(() => expect(screen.getAllByTestId("delivery-row")).toHaveLength(2));
    const detail = screen.getByTestId("delivery-detail");
    expect(detail.textContent).toContain("evt_flaky");
    expect(detail.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(detail.textContent).toContain("503");

    fireEvent.click(screen.getByText("evt_ok"));
    await waitFor(() =>
      expect(screen.getByTestId("delivery-detail").querySelectorAll("tbody tr")).toHaveLength(1),
    );
  });

  it("says so when nothing has been delivered", async () => {
    fakeSim({ routes: { "GET /_sim/api/deliveries": () => json({ body: { deliveries: null } }) } });
    render(<DeliveriesView />);

    await waitFor(() => expect(screen.getByText("No deliveries yet")).toBeTruthy());
  });
});
