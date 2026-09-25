/**
 * @vitest-environment jsdom
 * The screen delegates overlay management to a drawer registry, enabling
 * consistent address vocabulary across the application.
 */

import { RUNAWAY_PAUSE_REASON } from "@langwatch/automation-contract";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const triggers = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  /** What the other automation reads answer, keyed by procedure name. */
  reads: {} as Record<string, unknown>,
}));

vi.mock("../../../behavior/automation-api.ts", () => {
  const emptyQuery = { data: undefined, isLoading: false, isFetching: false, error: null };
  const node = (): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (property === "useQuery") return () => emptyQuery;
          if (property === "useMutation") return () => ({ mutate: () => {}, isPending: false });
          if (property === "invalidate") return () => {};
          return node();
        },
      },
    );
  const api = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "useUtils") return () => node();
        if (property === "automation") {
          return new Proxy(
            {},
            {
              get(_t, procedure) {
                if (procedure === "getTriggers") {
                  return { useQuery: () => ({ data: triggers.rows, isLoading: false }) };
                }
                if (typeof procedure === "string" && procedure in triggers.reads) {
                  return {
                    useQuery: () => ({ data: triggers.reads[procedure], isLoading: false }),
                  };
                }
                return node();
              },
            },
          );
        }
        return node();
      },
    },
  );
  return { api, automationApi: api };
});

/**
 * Both editors, as anything the screen mounted would print. Stubbed
 * rather than left real, so "the screen renders neither" is an
 * assertion about the screen, not about a thousand lines of Chakra.
 */
vi.mock("../../../features/authoring/ui/sections/automation-drawer.tsx", () => ({
  AutomationDrawer: () => <div>the editor</div>,
}));

vi.mock("../../../features/authoring/ui/sections/view-automation-drawer.tsx", () => ({
  ViewAutomationDrawer: () => <div>the panel</div>,
}));

import { fakeAutomationHost, renderWithAutomationHost } from "../../../testing.tsx";
import type { AutomationSection } from "../automations-layout.tsx";
import AutomationsPage from "../automations-screen.tsx";

const TRACE_AUTOMATION = {
  id: "tr_1",
  name: "Error digest",
  action: "SEND_EMAIL",
  triggerKind: "AUTOMATION",
  actionParams: { members: ["ada@example.com"] },
  filters: {},
  filterQuery: "status:error",
  active: true,
  pausedReason: null,
  alertType: null,
  customGraphId: null,
  notificationCadence: "immediate",
  traceDebounceMs: 5000,
  checks: [],
};

function openScreen(query: Record<string, string | undefined> = {}) {
  const host = fakeAutomationHost({ permissions: ["triggers:manage"], query });
  renderWithAutomationHost(<AutomationsPage section="automations" />, { host });
  return host;
}

afterEach(() => {
  cleanup();
  triggers.rows = [];
  triggers.reads = {};
});

describe("given the automations list", () => {
  describe("when a row is clicked", () => {
    /** @scenario "The automations list opens its viewer at the registered address" */
    it("asks for the viewer on that automation, by the name the registry answers to", async () => {
      triggers.rows = [TRACE_AUTOMATION];
      const host = openScreen();

      await userEvent.click(screen.getByText("Error digest"));

      expect(host.recording.drawerOpens.at(-1)).toEqual({
        drawer: "viewAutomation",
        params: { automationId: "tr_1" },
      });
    });

    it("does not render the panel itself, so the registry's is the only one", async () => {
      triggers.rows = [TRACE_AUTOMATION];
      openScreen();

      await userEvent.click(screen.getByText("Error digest"));

      expect(screen.queryByText("the panel")).toBeNull();
    });
  });

  describe("when a row's Edit action is chosen", () => {
    /** @scenario "The automations list opens its editor at the registered address" */
    it("asks for the editor on that automation", async () => {
      triggers.rows = [TRACE_AUTOMATION];
      const host = openScreen();

      await userEvent.click(screen.getByLabelText("Actions for Error digest"));
      await userEvent.click(await screen.findByText("Edit"));

      expect(host.recording.drawerOpens.at(-1)).toEqual({
        drawer: "automation",
        params: { automationId: "tr_1" },
      });
    });
  });

  describe("when a new automation is started", () => {
    /** @scenario "Creating an automation opens the editor with no automation named" */
    it("asks for the editor carrying the prefills and no automation id", async () => {
      const host = openScreen();

      await userEvent.click(screen.getByText("New automation"));

      expect(host.recording.drawerOpens.at(-1)).toEqual({ drawer: "automation", params: {} });
    });
  });
});

describe("given an address that already names one of the two overlays", () => {
  describe("when the screen renders under it", () => {
    it("renders neither editor, because the registry mounts whichever one it names", () => {
      openScreen({ "drawer.open": "automation", "drawer.automationId": "tr_1" });

      expect(screen.queryByText("the editor")).toBeNull();
      expect(screen.queryByText("the panel")).toBeNull();
    });
  });
});

const sectionBase = {
  filters: {},
  filterQuery: null,
  active: true,
  pausedReason: null,
  alertType: null,
  customGraphId: null,
  notificationCadence: "immediate",
  traceDebounceMs: 5000,
  checks: [],
};

const rows = [
  {
    ...sectionBase,
    id: "tr_email",
    name: "Error digest",
    action: "SEND_EMAIL",
    triggerKind: "AUTOMATION",
    actionParams: { members: ["ada@example.com", "bob@example.com"] },
    checks: [
      { id: "m1", name: "Toxicity" },
      { id: "m2", name: "PII" },
    ],
  },
  {
    ...sectionBase,
    id: "tr_paused",
    name: "Every trace",
    action: "SEND_SLACK_MESSAGE",
    triggerKind: "AUTOMATION",
    actionParams: { slackWebhook: "https://hooks.slack.com/x" },
    pausedReason: RUNAWAY_PAUSE_REASON,
  },
  {
    ...sectionBase,
    id: "tr_capped",
    name: "Noisy one",
    action: "SEND_EMAIL",
    triggerKind: "AUTOMATION",
    actionParams: { members: ["c@example.com"] },
    active: false,
  },
  {
    ...sectionBase,
    id: "al_1",
    name: "Latency alert",
    action: "SEND_EMAIL",
    triggerKind: "AUTOMATION",
    customGraphId: "graph_1",
    actionParams: { members: ["ops@example.com"], operator: "gt", threshold: 2, seriesName: "p95" },
  },
  {
    ...sectionBase,
    id: "rp_1",
    name: "Weekly report",
    action: "SEND_EMAIL",
    triggerKind: "REPORT",
    actionParams: { members: ["team@example.com"], cron: "0 9 * * 1" },
  },
];

function renderSection(section: AutomationSection): string {
  const host = fakeAutomationHost({ permissions: ["triggers:manage"], query: {} });
  renderWithAutomationHost(<AutomationsPage section={section} />, { host });
  return document.body.textContent ?? "";
}

describe("AutomationsPage sections", () => {
  describe("given a project with every kind of automation", () => {
    const withData = () => {
      triggers.rows = rows;
      triggers.reads = {
        getTriggerStats: [
          { triggerId: "al_1", currentlyFiring: true, recentFireCount: 3, lastFiredAt: null },
          { triggerId: "tr_email", currentlyFiring: false, recentFireCount: 4, lastFiredAt: null },
        ],
        getDailyCapStatus: { cap: 1000, counts: { tr_capped: { skipped: 1234 } } },
        getReportSchedules: [],
        getRecentActivity: [],
      };
    };

    for (const section of ["overview", "alerts", "schedules", "automations"] as const) {
      it(`prints the ${section} section`, () => {
        withData();
        expect(renderSection(section)).toMatchSnapshot();
      });
    }
  });

  describe("given a project with no automations", () => {
    for (const section of ["overview", "alerts", "schedules", "automations"] as const) {
      it(`prints the empty ${section} section`, () => {
        triggers.rows = [];
        expect(renderSection(section)).toMatchSnapshot();
      });
    }
  });
});
