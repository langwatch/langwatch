/**
 * @vitest-environment jsdom
 *
 * Settings > Audit Log: what a reader sees, what the plan gate says, and what a
 * downloaded report is taken over.
 *
 * THE PLATFORM PAGE HAD NO RENDER SUITE AT ALL. Every page-level scenario in
 * `specs/audit-log/audit-log.feature` was tagged `@unimplemented` and the
 * feature file said so in a comment: "the page is implemented in
 * `src/pages/settings/audit-log.tsx` but no JSDOM render integration test
 * exists for it yet". These are those scenarios.
 *
 * THE EXPORT IS THE PROPERTY THIS SURFACE ACTUALLY TURNS ON: a report taken
 * from a pre-filtered deep-link that quietly widened to the whole
 * organization's history would be a disclosure dressed up as a convenience.
 *
 * Spec: specs/audit-log/audit-log.feature
 */

import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeOrganizationHost, renderWithOrganizationHost } from "../../../testing";
import AuditLogScreen from "../audit-log.screen";

const { state } = vi.hoisted(() => ({
  state: {
    planType: "ENTERPRISE" as string,
    planLoading: false,
    auditLogs: [] as Array<Record<string, unknown>>,
    totalCount: 0,
    isLoading: false,
    members: [] as Array<Record<string, unknown>>,
    fetchPages: [] as Array<{ auditLogs: Array<Record<string, unknown>>; totalCount: number }>,
    fetchRejectsWith: void 0 as unknown,
  },
}));

const calls = vi.hoisted(() => ({
  listQuery: vi.fn(),
  exportFetch: vi.fn(),
}));

vi.mock("../../../behavior/organization-api", () => ({
  organizationApi: {
    useUtils: () => ({
      organization: {
        getAuditLogs: {
          fetch: async (input: unknown) => {
            calls.exportFetch(input);
            if (state.fetchRejectsWith) throw state.fetchRejectsWith;
            return state.fetchPages.shift() ?? { auditLogs: [], totalCount: state.totalCount };
          },
        },
      },
    }),
    organization: {
      getAuditLogs: {
        useQuery: (input: unknown) => {
          calls.listQuery(input);
          return {
            data: { auditLogs: state.auditLogs, totalCount: state.totalCount },
            isLoading: state.isLoading,
          };
        },
      },
      getOrganizationWithMembersAndTheirTeams: {
        useQuery: () => ({ data: { members: state.members }, isLoading: false }),
      },
    },
    limits: {
      getUsage: {
        useQuery: () => ({
          data: state.planLoading ? void 0 : { activePlan: { type: state.planType } },
          isLoading: state.planLoading,
        }),
      },
    },
  },
}));

vi.mock("@langwatch/design-system/page-layout", () => ({
  PageLayout: {
    HeaderButton: ({ children, ...props }: { children: ReactNode }) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
  },
}));

vi.mock("@langwatch/enterprise-billing-web", () => ({
  ContactSalesBlock: () => <div data-testid="contact-sales-block">Need more?</div>,
}));

function auditRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "audit-1",
    createdAt: new Date("2026-03-04T09:30:00.000Z"),
    userId: "u-1",
    organizationId: "org-1",
    projectId: "proj-1",
    action: "gateway.virtual_key.created",
    payload: null,
    ipAddress: "203.0.113.9",
    userAgent: "Mozilla/5.0",
    error: null,
    args: null,
    user: { id: "u-1", name: "Alice", email: "alice@example.com" },
    project: { id: "proj-1", name: "Web App" },
    source: "gateway",
    targetKind: "virtual_key",
    targetId: "vk_abcdefghijklmnopqrstuvwxyz",
    before: null,
    after: null,
    ...overrides,
  };
}

beforeEach(() => {
  state.planType = "ENTERPRISE";
  state.planLoading = false;
  state.auditLogs = [];
  state.totalCount = 0;
  state.isLoading = false;
  state.members = [];
  state.fetchPages = [];
  state.fetchRejectsWith = void 0;
  calls.listQuery.mockReset();
  calls.exportFetch.mockReset();
});

afterEach(() => cleanup());

describe("given an organization below the Enterprise plan", () => {
  describe("when the audit page is opened", () => {
    /** @scenario A deployment below the plan is told what the audit trail would show */
    it("says what the capability covers instead of hiding it", () => {
      state.planType = "LAUNCH";
      renderWithOrganizationHost(<AuditLogScreen />);

      expect(screen.getByText("Enterprise Feature")).toBeInTheDocument();
      expect(screen.getByTestId("contact-sales-block")).toBeInTheDocument();
    });

    /** @scenario A deployment below the plan is told what the audit trail would show */
    it("renders no table at all", () => {
      state.planType = "LAUNCH";
      state.auditLogs = [auditRow()];
      renderWithOrganizationHost(<AuditLogScreen />);

      expect(screen.queryByText("Timestamp")).not.toBeInTheDocument();
    });
  });
});

describe("given an Enterprise organization with a mixed audit history", () => {
  describe("when the table renders", () => {
    /** @scenario Settings audit page lists gateway and platform events together */
    it("shows a gateway row and a platform row with their own Source badges", () => {
      state.auditLogs = [
        auditRow(),
        auditRow({
          id: "audit-2",
          action: "organization.member.add",
          source: "platform",
          targetKind: null,
          targetId: null,
          projectId: null,
        }),
      ];
      state.totalCount = 2;
      renderWithOrganizationHost(<AuditLogScreen />);

      expect(screen.getByText("Gateway")).toBeInTheDocument();
      expect(screen.getByText("Platform")).toBeInTheDocument();
      expect(screen.getByText("gateway.virtual_key.created")).toBeInTheDocument();
      expect(screen.getByText("organization.member.add")).toBeInTheDocument();
    });

    /** @scenario Settings audit page lists gateway and platform events together */
    it("shows the gateway row's target kind and a truncated id", () => {
      state.auditLogs = [auditRow()];
      state.totalCount = 1;
      renderWithOrganizationHost(<AuditLogScreen />);

      expect(screen.getByText("virtual_key")).toBeInTheDocument();
      // Sixteen characters and an ellipsis. The full id is 29 long, so a cell
      // that rendered it whole would fail here rather than merely look wide.
      expect(screen.getByText(/^vk_abcdefghijklm/)).toBeInTheDocument();
      expect(screen.queryByText(/vwxyz/)).not.toBeInTheDocument();
    });

    /** @scenario Settings audit page lists gateway and platform events together */
    it("names the project a scoped row belongs to", () => {
      state.auditLogs = [auditRow()];
      state.totalCount = 1;
      renderWithOrganizationHost(<AuditLogScreen />);

      const table = screen.getByRole("table");
      expect(within(table).getByText("Web App")).toBeInTheDocument();
    });

    /** @scenario A row written by a system actor says so rather than naming nobody */
    it("says the actor is unknown rather than rendering an empty cell", () => {
      state.auditLogs = [auditRow({ userId: null, user: null })];
      state.totalCount = 1;
      renderWithOrganizationHost(<AuditLogScreen />);

      expect(screen.getByText("User not found")).toBeInTheDocument();
    });
  });

  describe("when the history is empty", () => {
    /** @scenario An empty audit history says so */
    it("says so rather than rendering a headerless table", () => {
      renderWithOrganizationHost(<AuditLogScreen />);

      expect(screen.getByText("No audit logs found")).toBeInTheDocument();
    });
  });
});

describe("given a reader who arrived from a Virtual Key detail page", () => {
  const deepLinked = () =>
    new FakeOrganizationHost({
      query: { targetKind: "virtual_key", targetId: "vk_abcdefghijklmnopqrstuvwxyz" },
    });

  describe("when the page renders", () => {
    /** @scenario Deep-link from VK detail page lands pre-filtered */
    it("sends the target filter to the read", () => {
      renderWithOrganizationHost(<AuditLogScreen />, deepLinked());

      expect(calls.listQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          targetKind: "virtual_key",
          targetId: "vk_abcdefghijklmnopqrstuvwxyz",
        }),
      );
    });

    /** @scenario Deep-link from VK detail page lands pre-filtered */
    it("shows a clearable chip naming the target", () => {
      renderWithOrganizationHost(<AuditLogScreen />, deepLinked());

      expect(screen.getByTitle("Clear target filter")).toBeInTheDocument();
    });

    /** @scenario A deep-linked reader is offered the way back to the resource */
    it("offers the way back to the resource", () => {
      renderWithOrganizationHost(<AuditLogScreen />, deepLinked());

      expect(screen.getByText("Virtual key")).toBeInTheDocument();
    });
  });

  describe("when the chip is cleared", () => {
    /** @scenario Deep-link from VK detail page lands pre-filtered */
    it("writes an address with both halves of the target gone", async () => {
      const host = deepLinked();
      renderWithOrganizationHost(<AuditLogScreen />, host);

      await userEvent.click(screen.getByTitle("Clear target filter"));

      expect(host.queries.at(-1)).toEqual({});
    });
  });
});

describe("given a reader exporting the audit trail", () => {
  describe("when the view is pre-filtered by a deep-link", () => {
    /**
     * THE PROPERTY THIS PAGE TURNS ON. An export that widened past the filters
     * on screen would hand a reviewer rows they did not ask for and did not
     * know they had.
     */
    /** @scenario An export is taken over exactly the filters on screen */
    it("asks for exactly the filters the table is reading with", async () => {
      const host = new FakeOrganizationHost({
        query: { targetKind: "budget", targetId: "b_1", actionFilter: "gateway." },
      });
      state.auditLogs = [auditRow()];
      state.totalCount = 1;
      state.fetchPages = [{ auditLogs: [auditRow()], totalCount: 1 }];
      renderWithOrganizationHost(<AuditLogScreen />, host);

      await userEvent.click(screen.getByRole("button", { name: /Export CSV/ }));

      await waitFor(() => expect(calls.exportFetch).toHaveBeenCalled());
      expect(calls.exportFetch).toHaveBeenCalledWith(
        expect.objectContaining({
          targetKind: "budget",
          targetId: "b_1",
          action: "gateway.",
        }),
      );
    });
  });

  describe("when the report is ready", () => {
    /** @scenario An exported report carries the same columns the table shows */
    it("hands the application a dated CSV rather than reaching for the browser", async () => {
      state.auditLogs = [auditRow()];
      state.totalCount = 1;
      state.fetchPages = [{ auditLogs: [auditRow()], totalCount: 1 }];
      const { host } = renderWithOrganizationHost(<AuditLogScreen />);

      await userEvent.click(screen.getByRole("button", { name: /Export CSV/ }));

      await waitFor(() => expect(host.downloads).toHaveLength(1));
      const file = host.downloads[0]!;
      expect(file.fileName).toMatch(/^audit_logs_\d{4}-\d{2}-\d{2}\.csv$/);
      expect(file.mediaType).toBe("text/csv");
      expect(file.contents).toContain("Timestamp");
      expect(file.contents).toContain("gateway.virtual_key.created");
    });
  });

  describe("when the history spans more than one batch", () => {
    /** @scenario An export walks the whole filtered history, not just the first batch */
    it("walks every page before handing the file over", async () => {
      state.auditLogs = [auditRow()];
      state.totalCount = 1;
      state.fetchPages = [
        { auditLogs: [auditRow({ id: "a-1" })], totalCount: 7000 },
        { auditLogs: [auditRow({ id: "a-2" })], totalCount: 7000 },
      ];
      const { host } = renderWithOrganizationHost(<AuditLogScreen />);

      await userEvent.click(screen.getByRole("button", { name: /Export CSV/ }));

      await waitFor(() => expect(host.downloads).toHaveLength(1));
      expect(calls.exportFetch).toHaveBeenCalledTimes(2);
      expect(calls.exportFetch).toHaveBeenLastCalledWith(
        expect.objectContaining({ pageOffset: 5000 }),
      );
    });
  });

  describe("when the export fails", () => {
    /**
     * The platform page logged this to the console and left the reader looking
     * at a button that had visibly done nothing.
     */
    /** @scenario An export that fails tells the reader rather than the console */
    it("tells the reader rather than failing silently", async () => {
      state.auditLogs = [auditRow()];
      state.totalCount = 1;
      state.fetchRejectsWith = new Error("boom");
      const { host } = renderWithOrganizationHost(<AuditLogScreen />);

      await userEvent.click(screen.getByRole("button", { name: /Export CSV/ }));

      await waitFor(() => expect(host.failures).toHaveLength(1));
      expect(host.failures[0]?.fallbackTitle).toBe("Couldn't export the audit log");
      expect(host.downloads).toHaveLength(0);
    });
  });
});

describe("given a reader narrowing the table", () => {
  describe("when a user is searched for", () => {
    /** @scenario The user search resolves a typed name or address to one actor */
    it("sends the matched member's id rather than the typed string", async () => {
      state.members = [
        { userId: "u-9", user: { id: "u-9", name: "Alice Doe", email: "alice@example.com" } },
      ];
      renderWithOrganizationHost(<AuditLogScreen />);

      await userEvent.type(screen.getByLabelText("Search by User"), "alice");

      await waitFor(() =>
        expect(calls.listQuery).toHaveBeenLastCalledWith(
          expect.objectContaining({ userId: "u-9" }),
        ),
      );
    });
  });

  describe("when a project is picked", () => {
    /** @scenario Changing a filter returns the table to its first page */
    it("writes the project into the address and returns to the first page", async () => {
      const host = new FakeOrganizationHost({ query: { pageOffset: "50" } });
      renderWithOrganizationHost(<AuditLogScreen />, host);

      await userEvent.selectOptions(screen.getByLabelText("Project"), "proj-2");

      expect(host.queries.at(-1)).toMatchObject({ projectId: "proj-2", pageOffset: "0" });
    });
  });
});

describe("given more rows than one page holds", () => {
  describe("when the reader steps forward", () => {
    /** @scenario The audit table pages by offsets carried in the address */
    it("writes the next offset into the address", async () => {
      state.auditLogs = [auditRow()];
      state.totalCount = 120;
      const host = new FakeOrganizationHost();
      renderWithOrganizationHost(<AuditLogScreen />, host);

      await userEvent.click(screen.getByRole("button", { name: "Go to next page" }));

      expect(host.queries.at(-1)).toMatchObject({ pageOffset: "25" });
    });
  });
});
