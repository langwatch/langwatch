/** @vitest-environment jsdom */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type {
  DirectoryActivityEntryView,
  OrganizationReconciliation,
} from "@ee/scim/scim-reconciliation.types";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state, activityQuery, refetchActivity } = vi.hoisted(() => {
  const state: OrganizationReconciliation & {
    activity: DirectoryActivityEntryView[];
    activityLoading: boolean;
    activityError: Error | null;
    activityFetching: boolean;
  } = {
    connections: [],
    recentChanges: [],
    activity: [],
    activityLoading: false,
    activityError: null,
    activityFetching: false,
  };
  const refetchActivity = vi.fn(async () => ({}));
  const activityQuery = vi.fn(() => ({
    data: state.activity,
    isLoading: state.activityLoading,
    isError: state.activityError !== null,
    error: state.activityError,
    isFetching: state.activityFetching,
    refetch: refetchActivity,
  }));
  return { state, activityQuery, refetchActivity };
});

vi.mock("~/utils/api", () => ({
  api: {
    scimReconciliation: {
      getActivity: { useQuery: activityQuery },
      getAll: {
        useQuery: () => ({
          data: {
            connections: state.connections,
            recentChanges: state.recentChanges,
          },
          isLoading: false,
          isError: false,
          error: null,
        }),
      },
      getRequests: {
        useQuery: () => ({
          data: [],
          isLoading: false,
          isError: false,
          error: null,
        }),
      },
    },
  },
}));

const { ScimReconciliationPanel } = await import("../ScimReconciliationPanel");

const draw = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <ScimReconciliationPanel
        organizationId="org_acme"
        maySetUpSingleSignOn={true}
      />
    </ChakraProvider>,
  );

beforeEach(() => {
  state.connections = [
    {
      connectionId: "conn_1",
      providerId: "lw",
      verifiedDomains: ["acme1.test"],
      connectionState: "ACTIVE",
      state: "SYNCING",
      status: { headline: "Syncing", waitingFor: "", tone: "working" },
      lastPushedAtMs: Date.parse("2026-09-16T17:57:00Z"),
      managedPeople: 498,
      failures: [],
      remediation: "",
    },
  ];
  state.recentChanges = [];
  state.activity = [
    {
      eventId: "private_event_2",
      summary: "Your directory switched off access for Xan",
      occurredAtMs: Date.parse("2026-09-16T17:57:00Z"),
      outcome: "ok",
    },
    {
      eventId: "private_event_1",
      summary: "An access change could not be applied",
      occurredAtMs: Date.parse("2026-09-16T17:56:00Z"),
      outcome: "refused",
    },
  ];
  state.activityLoading = false;
  state.activityError = null;
  state.activityFetching = false;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the connectors page's connection band", () => {
  describe("when an administrator opens it", () => {
    /** @scenario "What the provider sent is there for whoever needs it, and folded for everybody else" */
    it("folds what the provider sent away until it is asked for", () => {
      draw();

      expect(screen.queryByTestId("directory-requests")).toBeNull();

      fireEvent.click(screen.getByTestId("directory-requests-toggle"));
      expect(screen.getByTestId("directory-requests")).toBeTruthy();
    });

    /** @scenario "The connection's name leads to the connection" */
    it("takes the reader from the connection's name to the connection", () => {
      draw();

      expect(screen.getByTestId("connector-provider-link")).toHaveAttribute(
        "href",
        "/settings/authentication/provider",
      );
    });

    /** @scenario "Changes to the connection itself are where they belong, and said so" */
    it("says where changes to the connection itself are, and links there", () => {
      draw();

      const pointer = screen.getByText(/changes to the connection itself/i);
      expect(within(pointer).getByRole("link")).toHaveAttribute(
        "href",
        "/settings/authentication/provider",
      );
    });
  });
});

describe("recent directory activity", () => {
  describe("when its connection's disclosure is opened", () => {
    /** @scenario "Recent directory activity is read only when its section is opened" */
    it("reads the selected connection only while open", async () => {
      const first = state.connections[0];
      if (!first) throw new Error("The connection fixture is missing");
      state.connections.push({
        ...first,
        connectionId: "conn_2",
        providerId: "Second provider",
      });
      draw();

      expect(activityQuery).not.toHaveBeenCalled();
      const toggle = screen.getAllByRole("button", {
        name: "Recent directory activity",
      })[1];
      if (!toggle) throw new Error("The second connection is missing");
      fireEvent.click(toggle);
      await waitFor(() => {
        expect(activityQuery).toHaveBeenCalledWith({
          organizationId: "org_acme",
          connectionId: "conn_2",
        });
      });
      expect(
        screen.getByRole("list", { name: "Recent directory activity" }),
      ).toBeVisible();

      activityQuery.mockClear();
      fireEvent.click(toggle);
      await waitFor(() => expect(screen.queryByRole("list")).toBeNull());
      expect(activityQuery).not.toHaveBeenCalled();
    });

    /** @scenario "What the directory has been doing is listed newest first" */
    it("shows ordered summaries, outcomes and times without exposing identifiers", async () => {
      draw();
      fireEvent.click(
        screen.getByRole("button", { name: "Recent directory activity" }),
      );
      const rows = await screen.findAllByRole("listitem");
      expect(rows).toHaveLength(2);
      expect(rows[0]).toHaveTextContent(
        "Your directory switched off access for Xan",
      );
      expect(rows[0]).toHaveTextContent("Recorded");
      expect(rows[0]).toHaveTextContent(
        new Date("2026-09-16T17:57:00Z").toLocaleString(),
      );
      expect(rows[1]).toHaveTextContent(
        "An access change could not be applied",
      );
      expect(rows[1]).toHaveTextContent("Refused");
      expect(screen.queryByText(/private_event/)).toBeNull();
      expect(screen.queryByText(/has not changed anyone/)).toBeNull();
      expect(
        screen.queryByRole("heading", { name: /access changes assigned/i }),
      ).toBeNull();
    });

    /** @scenario "Loading directory activity does not imply an empty history" */
    it("shows a pending read without claiming the history is empty", async () => {
      state.activity = [];
      state.activityLoading = true;
      draw();
      fireEvent.click(
        screen.getByRole("button", { name: "Recent directory activity" }),
      );
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
      fireEvent.click(
        screen.getByRole("button", { name: "Recent directory activity" }),
      );
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
      fireEvent.click(
        screen.getByRole("button", { name: "Recent directory activity" }),
      );
      expect(
        await screen.findByText(
          "No recent directory activity is recorded for this connection.",
        ),
      ).toBeVisible();
      expect(screen.queryByRole("list")).toBeNull();
    });
  });

  describe("when directory-assigned access changes also exist", () => {
    it("retains their separate list and show-more control", () => {
      state.recentChanges = Array.from({ length: 9 }, (_, index) => ({
        grantId: `grant_${index}`,
        summary: `Access assigned to person ${index}`,
        author: "Your identity provider",
        occurredAtMs: Date.parse("2026-09-16T17:57:00Z"),
        kind: "attached",
      }));
      draw();
      expect(
        screen.getByRole("heading", {
          name: "Access changes assigned by your identity provider",
        }),
      ).toBeVisible();
      expect(screen.getAllByText(/Access assigned to person/)).toHaveLength(8);
      fireEvent.click(screen.getByRole("button", { name: "Show 1 more" }));
      expect(screen.getAllByText(/Access assigned to person/)).toHaveLength(9);
      fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));
      expect(screen.getAllByText(/Access assigned to person/)).toHaveLength(8);
    });
  });
});
