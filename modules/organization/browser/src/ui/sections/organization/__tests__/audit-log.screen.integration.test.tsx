/**
 * @vitest-environment jsdom
 *
 * Audit-log screen: guards pre-filtered deep-links from widening to full history.
 * @see specs/audit-log/audit-log.feature
 */

import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeOrganizationHost, renderWithOrganizationHost } from "../../../../testing.tsx";
import AuditLogScreen from "../audit-log.screen.tsx";

const { state } = vi.hoisted(() => ({
  state: {
    planType: "ENTERPRISE" as string,
    planLoading: false,
    auditLogs: [] as Record<string, unknown>[],
    totalCount: 0,
    isLoading: false,
    members: [] as Record<string, unknown>[],
    fetchPages: [] as { auditLogs: Record<string, unknown>[]; totalCount: number }[],
    fetchRejectsWith: void 0 as unknown,
  },
}));

const calls = vi.hoisted(() => ({
  listQuery: vi.fn(),
  exportFetch: vi.fn(),
}));

vi.mock("../../../../behavior/organization-api.ts", () => ({
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
  },
}));

/** The host answers the plan facts the screen gates on, from this file's state. */
function planHost(options: ConstructorParameters<typeof FakeOrganizationHost>[0] = {}) {
  return new FakeOrganizationHost({
    isEnterprise: state.planType === "ENTERPRISE",
    isPlanLoading: state.planLoading,
    ...options,
  });
}

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
    actorUserId: null,
    actorUser: null,
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
    it("says what the capability covers instead of hiding it", async () => {
      state.planType = "LAUNCH";
      renderWithOrganizationHost(<AuditLogScreen />, planHost());

      expect(screen.getByText("Enterprise Feature")).toBeInTheDocument();
      expect(await screen.findByTestId("contact-sales-block")).toBeInTheDocument();
    });

    /** @scenario A deployment below the plan is told what the audit trail would show */
    it("renders no table at all", () => {
      state.planType = "LAUNCH";
      state.auditLogs = [auditRow()];
      renderWithOrganizationHost(<AuditLogScreen />, planHost());

      expect(screen.queryByText("Timestamp")).not.toBeInTheDocument();
    });
  });
});

describe("given an Enterprise organization with a mixed audit history", () => {
  describe("when the feed renders", () => {
    /** @scenario Settings audit page lists gateway and platform events together */
    it("marks the gateway entry as the gateway's and reads each action as a sentence", () => {
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
      renderWithOrganizationHost(<AuditLogScreen />, planHost());

      expect(screen.getAllByLabelText("AI Gateway")).toHaveLength(1);
      expect(screen.queryByText("Platform")).not.toBeInTheDocument();
      const [gateway, platform] = screen.getAllByTestId("audit-log-entry");
      expect(gateway).toHaveTextContent(
        "Alice created virtual key vk_abcdefghijklmnopqrstuvwxyz in Web App",
      );
      expect(within(gateway!).getByText("gateway.virtual_key.created")).toBeInTheDocument();
      expect(platform).toHaveTextContent("Alice added member");
    });

    /** @scenario Every entry says where it came from */
    it("shows the address and the browser on every entry", () => {
      state.auditLogs = [
        auditRow({
          userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
        }),
      ];
      state.totalCount = 1;
      renderWithOrganizationHost(<AuditLogScreen />, planHost());

      expect(screen.getByText("203.0.113.9")).toBeInTheDocument();
      expect(screen.getByText("Chrome on macOS")).toBeInTheDocument();
    });

    /** @scenario A change reads inline as its fields, old to new */
    it("summarises the change inline and opens the full diff on request", async () => {
      state.auditLogs = [
        auditRow({ before: { baseUrl: "api.openai.com" }, after: { baseUrl: "llmsim.local" } }),
      ];
      state.totalCount = 1;
      renderWithOrganizationHost(<AuditLogScreen />, planHost());

      expect(screen.getByText("base url")).toBeInTheDocument();
      expect(screen.getByText("api.openai.com")).toBeInTheDocument();
      expect(screen.getByText("llmsim.local")).toBeInTheDocument();
      expect(screen.queryByTestId("audit-log-detail")).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "View diff" }));

      const detail = screen.getByTestId("audit-log-detail");
      expect(within(detail).getByText("Before")).toBeInTheDocument();
      expect(within(detail).getByText("After")).toBeInTheDocument();
      expect(within(detail).getByText("audit-1")).toBeInTheDocument();
    });

    /** @scenario A failed attempt reads as a failure */
    it("carries the error on its own red line", () => {
      state.auditLogs = [auditRow({ error: "FORBIDDEN: not allowed" })];
      state.totalCount = 1;
      renderWithOrganizationHost(<AuditLogScreen />, planHost());

      expect(screen.getByText("Failed")).toBeInTheDocument();
      expect(screen.getByTestId("audit-log-error")).toHaveTextContent("FORBIDDEN: not allowed");
    });

    /** @scenario A burst of identical events by one actor reads as one row */
    it("folds three identical consecutive events into one entry marked ×3", async () => {
      state.auditLogs = ["a", "b", "c"].map((id) => auditRow({ id }));
      state.totalCount = 3;
      renderWithOrganizationHost(<AuditLogScreen />, planHost());

      expect(screen.getAllByTestId("audit-log-entry")).toHaveLength(1);
      await userEvent.click(screen.getByRole("button", { name: "Show all 3 repeats" }));
      expect(screen.getAllByTestId("audit-log-repeat")).toHaveLength(2);
    });

    /** @scenario An impersonated entry names the operator as well as the person */
    it("reads the operator as the person", () => {
      state.auditLogs = [
        auditRow({
          actorUserId: "op-1",
          actorUser: { id: "op-1", name: "Admin", email: "admin@example.com" },
        }),
      ];
      state.totalCount = 1;
      renderWithOrganizationHost(<AuditLogScreen />, planHost());

      expect(screen.getByTestId("audit-log-entry")).toHaveTextContent(/^.*Admin as Alice created/);
    });

    /** @scenario The feed reads by day */
    it("heads the entries with their day", () => {
      state.auditLogs = [auditRow({ createdAt: new Date() })];
      state.totalCount = 1;
      renderWithOrganizationHost(<AuditLogScreen />, planHost());

      expect(screen.getByRole("region", { name: "Today" })).toBeInTheDocument();
    });

    /** @scenario A row written by a system actor says so rather than naming nobody */
    it("names the system as the actor rather than reporting a failed lookup", () => {
      state.auditLogs = [auditRow({ userId: null, user: null })];
      state.totalCount = 1;
      renderWithOrganizationHost(<AuditLogScreen />, planHost());

      expect(screen.getByText("System")).toBeInTheDocument();
      expect(screen.queryByText("User not found")).not.toBeInTheDocument();
    });

    /** @scenario A row written by a system actor says so rather than naming nobody */
    it("says the user is not found when the row names one that no longer resolves", () => {
      state.auditLogs = [auditRow({ userId: "u-gone", user: null })];
      state.totalCount = 1;
      renderWithOrganizationHost(<AuditLogScreen />, planHost());

      expect(screen.getByText("User not found")).toBeInTheDocument();
    });
  });

  describe("when the history is empty", () => {
    /** @scenario An empty audit history says so */
    it("says so rather than rendering a headerless table", () => {
      renderWithOrganizationHost(<AuditLogScreen />, planHost());

      expect(screen.getByText("No audit logs found")).toBeInTheDocument();
    });
  });
});

describe("given a user search that names nobody in the organization", () => {
  it("lists no entries instead of every entry", () => {
    state.members = [{ userId: "u-1", user: { name: "Alice", email: "alice@example.com" } }];
    state.auditLogs = [auditRow()];
    state.totalCount = 1;

    renderWithOrganizationHost(
      <AuditLogScreen />,
      planHost({ query: { userSearch: "nobody@none.test" } }),
    );

    expect(screen.getByText("No audit logs found")).toBeInTheDocument();
  });
});

describe("given a reader who arrived from a Virtual Key detail page", () => {
  const deepLinked = () =>
    planHost({
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
      const host = planHost({
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
      const { host } = renderWithOrganizationHost(<AuditLogScreen />, planHost());

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
      const { host } = renderWithOrganizationHost(<AuditLogScreen />, planHost());

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
      const { host } = renderWithOrganizationHost(<AuditLogScreen />, planHost());

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
      renderWithOrganizationHost(<AuditLogScreen />, planHost());

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
      const host = planHost({ query: { pageOffset: "50" } });
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
      const host = planHost();
      renderWithOrganizationHost(<AuditLogScreen />, host);

      await userEvent.click(screen.getByRole("button", { name: "Go to next page" }));

      expect(host.queries.at(-1)).toMatchObject({ pageOffset: "25" });
    });
  });
});
