// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RecordsView } from "../records-view.tsx";
import { fakeSim, json } from "./fake-sim.ts";

const records = [
  {
    id: "rec_3",
    channel: "webhook",
    target: "ok",
    method: "POST",
    headers: { "X-LangWatch-Event-Id": "evt_1", "X-LangWatch-Signature": "t=1,v1=abc" },
    body: '{"hello":"world"}',
    truncated: false,
    parsed: {},
    eventId: "evt_1",
    attempt: 1,
    signature: "valid",
    status: 200,
    dropped: false,
    latencyMs: 4,
    receivedAt: "2026-10-09T10:00:03Z",
  },
  {
    id: "rec_2",
    channel: "slack-webhook",
    target: "/services/T0SIM/B0SIGNUPS/x",
    method: "POST",
    headers: null,
    body: '{"text":"new sign-up"}',
    parsed: { text: "new sign-up" },
    status: 200,
    latencyMs: 1,
    receivedAt: "2026-10-09T10:00:02Z",
  },
  {
    id: "rec_1",
    channel: "sqs",
    target: "https://sqs.eu-west-1.amazonaws.com/000000000000/outboundsim",
    method: "POST",
    headers: {},
    body: "{}",
    parsed: null,
    status: 200,
    latencyMs: 2,
    receivedAt: "2026-10-09T10:00:01Z",
  },
];

describe("RecordsView", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  /** @scenario The console shows records, deliveries, faults and setup */
  it("lists records newest first and opens one with its signature verdict", async () => {
    fakeSim({ routes: { "GET /_sim/api/records": () => json({ body: { records } }) } });
    render(<RecordsView />);

    await waitFor(() => expect(screen.getAllByTestId("record-row")).toHaveLength(3));
    expect(screen.getByTestId("record-detail").textContent).toContain("Signature valid");
    expect(screen.getByTestId("record-detail").textContent).toContain("X-LangWatch-Event-Id");

    fireEvent.click(screen.getByText("/services/T0SIM/B0SIGNUPS/x"));
    await waitFor(() =>
      expect(screen.getByTestId("record-detail").textContent).toContain("new sign-up"),
    );
  });

  it("narrows the list by channel and by event id", async () => {
    fakeSim({ routes: { "GET /_sim/api/records": () => json({ body: { records } }) } });
    render(<RecordsView />);
    await waitFor(() => expect(screen.getAllByTestId("record-row")).toHaveLength(3));

    fireEvent.change(screen.getByLabelText("Channel"), { target: { value: "sqs" } });
    await waitFor(() => expect(screen.getAllByTestId("record-row")).toHaveLength(1));

    fireEvent.change(screen.getByLabelText("Channel"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Filter by event id"), { target: { value: "evt_1" } });
    await waitFor(() => expect(screen.getAllByTestId("record-row")).toHaveLength(1));
  });

  it("shows the sim's refusal when the records cannot be read", async () => {
    fakeSim({
      routes: {
        "GET /_sim/api/records": () =>
          json({ body: { error: "outboundsim is down" }, status: 500 }),
      },
    });
    render(<RecordsView />);

    await waitFor(() =>
      expect(screen.getAllByText(/outboundsim is down/u).length).toBeGreaterThan(0),
    );
  });
});
