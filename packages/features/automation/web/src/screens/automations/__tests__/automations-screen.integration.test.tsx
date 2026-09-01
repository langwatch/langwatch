/**
 * @vitest-environment jsdom
 *
 * The two editors this screen owns, and the addresses that open them.
 *
 * `platform/app` opened both through the application's drawer registry, which
 * writes a drawer NAME into the query string and mounts the component from a
 * registry the whole application shares. That registry is composition a
 * feature-web package may not reach, so the screen keeps the addresses itself
 * and renders the editors inline — the answer the gateway family's
 * routing-policy editor gave.
 *
 * What that makes worth pinning is the CONTRACT of those addresses, because
 * nothing else states it: `?automation=` opens the editor, `?viewAutomation=`
 * opens the panel, opening one drops the other, and closing either leaves an
 * address that no longer reopens anything. A renamed key would silently stop a
 * shared link from working, and no type would notice.
 *
 * The editors themselves are faked. What is under test is which address mounts
 * which one, and driving a thousand lines of Chakra to learn that would test the
 * drawer instead.
 */

import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const triggers = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../../behavior/automation-api", () => {
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

vi.mock("../../../features/authoring/ui/sections/automation-drawer", () => ({
  AutomationDrawer: ({ automationId, onClose }: { automationId?: string; onClose: () => void }) => (
    <div>
      <span>editing {automationId ?? "a new automation"}</span>
      <button type="button" onClick={onClose}>
        close the editor
      </button>
    </div>
  ),
}));

vi.mock("../../../features/authoring/ui/sections/view-automation-drawer", () => ({
  ViewAutomationDrawer: ({
    automationId,
    onEdit,
  }: {
    automationId: string;
    onEdit: (id: string) => void;
  }) => (
    <div>
      <span>viewing {automationId}</span>
      <button type="button" onClick={() => onEdit(automationId)}>
        edit from the panel
      </button>
    </div>
  ),
}));

import AutomationsPage from "../automations.screen";
import { fakeAutomationHost, renderWithAutomationHost } from "../../../testing";

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

describe("given an address that names an automation to edit", () => {
  describe("when the screen opens on it", () => {
    it("renders the editor for that automation", () => {
      openScreen({ automation: "tr_1" });

      expect(screen.getByText("editing tr_1")).toBeDefined();
      expect(screen.queryByText(/^viewing/)).toBeNull();
    });

    it("treats the reserved value as a fresh create", () => {
      openScreen({ automation: "new" });

      expect(screen.getByText("editing a new automation")).toBeDefined();
    });
  });
});

describe("given an address that names an automation to view", () => {
  describe("when the screen opens on it", () => {
    it("renders the panel for that automation", () => {
      openScreen({ viewAutomation: "tr_1" });

      expect(screen.getByText("viewing tr_1")).toBeDefined();
      expect(screen.queryByText(/^editing/)).toBeNull();
    });
  });
});

describe("given the automations list", () => {
  describe("when a row is clicked", () => {
    it("puts the automation in the address, so the same link reopens it", async () => {
      triggers.rows = [TRACE_AUTOMATION];
      const host = openScreen();

      await userEvent.click(screen.getByText("Error digest"));

      expect(host.recording.queries.at(-1)?.next).toEqual({ viewAutomation: "tr_1" });
      expect(screen.getByText("viewing tr_1")).toBeDefined();
    });
  });

  describe("when the panel hands over to the editor", () => {
    it("swaps the address rather than carrying both editors at once", async () => {
      const host = openScreen({ viewAutomation: "tr_1" });

      await userEvent.click(screen.getByText("edit from the panel"));

      expect(host.recording.queries.at(-1)?.next).toEqual({ automation: "tr_1" });
      expect(screen.getByText("editing tr_1")).toBeDefined();
      expect(screen.queryByText(/^viewing/)).toBeNull();
    });
  });

  describe("when the editor is closed", () => {
    it("leaves an address that no longer reopens it", async () => {
      openScreen({ automation: "tr_1" });

      await userEvent.click(screen.getByText("close the editor"));

      expect(screen.queryByText(/^editing/)).toBeNull();
    });
  });
});
