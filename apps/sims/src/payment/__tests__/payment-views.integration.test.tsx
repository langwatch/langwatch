// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PaymentConsole } from "../payment-console.tsx";
import { fakeSim, json } from "./fake-sim.ts";

const routes = {
  "GET /_sim/api/status": () =>
    json({
      body: {
        stack: "feat-x",
        webhookUrl: "http://app.test/api/webhooks/stripe",
        held: false,
        pending: 1,
        customers: 1,
        subscriptions: 1,
        invoices: 1,
      },
    }),
  "GET /_sim/api/customers": () =>
    json({
      body: {
        customers: [{ id: "cus_sim000001", created: 1_790_000_000, email: "a@b.c", name: "Acme" }],
      },
    }),
  "GET /_sim/api/subscriptions": () =>
    json({
      body: {
        subscriptions: [
          {
            id: "sub_sim000001",
            created: 1_790_000_000,
            customer: "cus_sim000001",
            status: "past_due",
            cancel_at_period_end: false,
            current_period_end: 1_792_000_000,
            items: {
              data: [
                {
                  quantity: 3,
                  price: { id: "price_1", nickname: "Growth seat", lookup_key: null },
                },
              ],
            },
          },
        ],
      },
    }),
  "GET /_sim/api/events": () =>
    json({
      body: {
        events: [
          {
            event: { id: "evt_1", type: "invoice.paid", created: 1_790_000_000 },
            attempts: [{ at: 1, status: 200, signed: "configured" }],
          },
          {
            event: { id: "evt_2", type: "invoice.payment_failed", created: 1_790_000_001 },
            attempts: [{ at: 2, status: 500, signed: "configured" }],
          },
          {
            event: { id: "evt_3", type: "customer.created", created: 1_790_000_002 },
            attempts: [],
          },
        ],
        pending: ["evt_3"],
        held: false,
      },
    }),
};

describe("PaymentConsole", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.location.hash = "";
  });

  /** @scenario The console shows customers, subscriptions, checkout sessions, invoices and webhook events */
  it("lists customers, subscriptions with plan and status, and each event's delivery status", async () => {
    fakeSim({ routes });
    render(<PaymentConsole />);

    await waitFor(() => expect(screen.getByText("cus_sim000001")).toBeTruthy());
    expect(screen.getByText("Acme")).toBeTruthy();

    window.location.hash = "#subscriptions";
    await waitFor(() => expect(screen.getByText("Growth seat x3")).toBeTruthy());
    expect(screen.getByText("past_due")).toBeTruthy();

    window.location.hash = "#events";
    await waitFor(() => expect(screen.getByText("evt_3")).toBeTruthy());
    expect(screen.getByText("delivered")).toBeTruthy();
    expect(screen.getByText("failed (500)")).toBeTruthy();
    expect(screen.getByText("queued")).toBeTruthy();
  });

  it("says so when the sim holds nothing", async () => {
    fakeSim({
      routes: { ...routes, "GET /_sim/api/customers": () => json({ body: { customers: null } }) },
    });
    render(<PaymentConsole />);

    await waitFor(() => expect(screen.getByText("No customers yet.")).toBeTruthy());
  });
});
