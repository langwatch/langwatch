/**
 * @vitest-environment jsdom
 * The screen delegates overlay management to a drawer registry, enabling
 * consistent address vocabulary across the application.
 */

import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const triggers = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
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

import AutomationsPage from "../automations-screen.tsx";
import { fakeAutomationHost, renderWithAutomationHost } from "../../../testing.tsx";

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
