/**
 * @vitest-environment jsdom
 *
 * Recent directory activity on each connection card, read only while open (ADR-126).
 */

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state, activityQuery, refetchActivity } = vi.hoisted(() => {
  const state = {
    connections: [] as Record<string, unknown>[],
    activity: [] as Record<string, unknown>[],
    activityLoading: false,
    activityError: null as Error | null,
  };
  const refetchActivity = vi.fn(async () => ({}));
  const activityQuery = vi.fn((_scope: { organizationId: string; connectionId: string }) => ({
    data: state.activity,
    isLoading: state.activityLoading,
    isError: state.activityError !== null,
    error: state.activityError,
    isFetching: false,
    refetch: refetchActivity,
  }));
  return { state, activityQuery, refetchActivity };
});

vi.mock("../../../behavior/scim-api.ts", () => ({
  scimApi: {
    scimReconciliation: {
      getAll: {
        useQuery: () => ({
          data: { connections: state.connections, recentChanges: [] },
          isLoading: false,
          isError: false,
        }),
      },
      getActivity: { useQuery: activityQuery },
    },
  },
}));

import { renderWithScimHost } from "../../../testing.tsx";
import { DirectoryReconciliation } from "../directory-reconciliation.tsx";

const LATER = Date.UTC(2026, 8, 16, 17, 57, 0);
const EARLIER = Date.UTC(2026, 8, 16, 17, 56, 0);

function connection(overrides: Record<string, unknown> = {}) {
  return {
    connectionId: "conn_1",
    providerId: "Okta",
    verifiedDomains: [],
    connectionState: "ACTIVE",
    state: "SYNCING",
    status: { headline: "Syncing", waitingFor: "", tone: "working" },
    lastPushedAtMs: LATER,
    managedPeople: 498,
    failures: [],
    remediation: "",
    ...overrides,
  };
}

function draw() {
  renderWithScimHost(<DirectoryReconciliation organizationId="org_acme" />);
}

function openActivity() {
  fireEvent.click(screen.getByRole("button", { name: "Recent directory activity" }));
}

beforeEach(() => {
  state.connections = [connection()];
  state.activity = [
    {
      eventId: "private_event_2",
      summary: "Your directory switched off access for Xan",
      occurredAtMs: LATER,
      outcome: "ok",
    },
    {
      eventId: "private_event_1",
      summary: "An access change could not be applied",
      occurredAtMs: EARLIER,
      outcome: "refused",
    },
  ];
  state.activityLoading = false;
  state.activityError = null;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("recent directory activity", () => {
  describe("when its connection's disclosure is opened", () => {
    /** @scenario "Recent directory activity is read only when its section is opened" */
    it("reads the selected connection only while open", async () => {
      state.connections = [
        connection(),
        connection({ connectionId: "conn_2", providerId: "Second provider" }),
      ];
      draw();

      expect(activityQuery).not.toHaveBeenCalled();
      const toggle = screen.getAllByRole("button", { name: "Recent directory activity" })[1];
      if (!toggle) throw new Error("The second connection is missing");
      fireEvent.click(toggle);
      await waitFor(() => {
        expect(activityQuery).toHaveBeenCalledWith({
          organizationId: "org_acme",
          connectionId: "conn_2",
        });
      });
      expect(activityQuery).not.toHaveBeenCalledWith({
        organizationId: "org_acme",
        connectionId: "conn_1",
      });
      expect(screen.getByRole("list", { name: "Recent directory activity" })).toBeVisible();

      activityQuery.mockClear();
      fireEvent.click(toggle);
      await waitFor(() => expect(screen.queryByRole("list")).toBeNull());
      expect(activityQuery).not.toHaveBeenCalled();
    });

    /** @scenario "What the directory has been doing is listed newest first" */
    it("shows ordered summaries, outcomes and times without exposing identifiers", async () => {
      draw();
      openActivity();

      const rows = await screen.findAllByRole("listitem");
      expect(rows).toHaveLength(2);
      expect(rows[0]).toHaveTextContent("Your directory switched off access for Xan");
      expect(rows[0]).toHaveTextContent("Recorded");
      expect(rows[0]).toHaveTextContent(new Date(LATER).toLocaleString());
      expect(rows[1]).toHaveTextContent("An access change could not be applied");
      expect(rows[1]).toHaveTextContent("Refused");
      expect(screen.queryByText(/private_event/)).toBeNull();
    });

    /** @scenario "Loading directory activity does not imply an empty history" */
    it("shows a pending read without claiming the history is empty", async () => {
      state.activity = [];
      state.activityLoading = true;
      draw();
      openActivity();

      expect(await screen.findByRole("status")).toHaveTextContent(
        "Loading recent directory activity",
      );
      expect(screen.queryByText(/No recent directory activity/)).toBeNull();
    });

    /** @scenario "A failed directory activity read can be retried" */
    it("offers a new read after an error without reporting an empty history", async () => {
      state.activity = [];
      state.activityError = new Error("read failed");
      draw();
      openActivity();

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "We couldn't load recent directory activity",
      );
      expect(screen.queryByText(/No recent directory activity/)).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Retry activity" }));
      expect(refetchActivity).toHaveBeenCalledTimes(1);
    });

    /** @scenario "A connection nothing has happened on says so rather than drawing an empty list" */
    it("describes the absence of recorded recent activity", async () => {
      state.activity = [];
      draw();
      openActivity();

      expect(
        await screen.findByText("No recent directory activity is recorded for this connection."),
      ).toBeVisible();
      expect(screen.queryByRole("list")).toBeNull();
    });
  });
});
