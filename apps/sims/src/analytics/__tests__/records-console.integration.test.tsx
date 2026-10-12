// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RecordsConsole } from "../records-console.tsx";

const records = [
  {
    id: "rec_000003",
    provider: "customerio",
    kind: "identify",
    distinctId: "user_1",
    properties: { scenario_count: 2 },
    receivedAt: "2026-09-30T10:00:03Z",
    raw: { userId: "user_1", traits: { scenario_count: 2 } },
  },
  {
    id: "rec_000002",
    provider: "customerio",
    kind: "event",
    distinctId: "user_1",
    name: "scenario_created",
    properties: { scenario_id: "scen_1" },
    receivedAt: "2026-09-30T10:00:02Z",
    raw: null,
  },
  {
    id: "rec_000001",
    provider: "posthog",
    kind: "event",
    distinctId: "user_2",
    name: "signed_up",
    properties: { projectId: "project_1" },
    receivedAt: "2026-09-30T10:00:01Z",
    raw: null,
  },
];

const json = ({ body, status = 200 }: { body: unknown; status?: number }) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const fakeSim = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(input, "http://analytics.test");
      if (url.pathname === "/_sim/api/status") {
        return json({
          body: {
            stack: "feat-x",
            records: 3,
            baseUrl: "http://analytics.test",
            activity: {
              total: 3,
              lastFiveMinutes: 2,
              distinctIds: 7,
              lastReceivedAt: "2026-09-30T10:00:03Z",
              lastName: "scenario_created",
            },
          },
        });
      }
      if (url.pathname === "/_sim/api/records") return json({ body: { records } });
      return json({ body: { error: "not_found" }, status: 404 });
    }),
  );

describe("the analyticssim console", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.location.hash = "";
  });

  /** @scenario The console lists records by provider and kind */
  it("lists every record newest first and opens one", async () => {
    fakeSim();
    render(<RecordsConsole />);

    await waitFor(() => expect(screen.getAllByTestId("record-row")).toHaveLength(3));
    expect(screen.getByTestId("record-detail").textContent).toContain("user_1");

    fireEvent.click(screen.getByText("signed_up"));
    await waitFor(() =>
      expect(screen.getByTestId("record-detail").textContent).toContain("project_1"),
    );
  });

  it("narrows the list by provider and by kind", async () => {
    fakeSim();
    render(<RecordsConsole />);
    await waitFor(() => expect(screen.getAllByTestId("record-row")).toHaveLength(3));

    fireEvent.click(screen.getByRole("tab", { name: /PostHog/u }));
    await waitFor(() => expect(screen.getAllByTestId("record-row")).toHaveLength(1));

    fireEvent.click(screen.getByRole("tab", { name: /All/u }));
    fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "identify" } });
    await waitFor(() => expect(screen.getAllByTestId("record-row")).toHaveLength(1));
  });

  /** @scenario "The console shows how busy the stack has been" */
  it("shows the stack's recent activity", async () => {
    fakeSim();
    render(<RecordsConsole />);

    await waitFor(() => expect(screen.getByTestId("activity").textContent).toContain("7"));
    expect(screen.getByTestId("activity").textContent).toContain("scenario_created");
  });

  /** @scenario "The console narrows the list to one person from a record" */
  it("narrows the list to the open record's distinct id", async () => {
    fakeSim();
    render(<RecordsConsole />);
    await waitFor(() => expect(screen.getAllByTestId("record-row")).toHaveLength(3));

    fireEvent.click(screen.getByText("signed_up"));
    fireEvent.click(await screen.findByRole("button", { name: "Records for this id" }));
    await waitFor(() => expect(screen.getAllByTestId("record-row")).toHaveLength(1));
    expect(screen.getByTestId("record-detail").textContent).toContain("user_2");
  });

  it("shows the sim's refusal when the records cannot be read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ body: { error: "analyticssim is down" }, status: 500 })),
    );
    render(<RecordsConsole />);

    await waitFor(() =>
      expect(screen.getAllByText(/analyticssim is down/u).length).toBeGreaterThan(0),
    );
  });
});
