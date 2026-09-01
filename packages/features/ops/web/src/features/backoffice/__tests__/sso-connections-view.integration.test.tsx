/**
 * @vitest-environment jsdom
 *
 * The back office's single sign-on list and its detail drawer.
 *
 * Corresponds to specs/identity/sso-onboarding-tiers.feature.
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SsoConnectionsView from "../ui/sections/sso-connections-view";
import { renderWithOpsHost } from "../../../testing";

const listState = vi.hoisted(() => ({
  current: {
    data: undefined as unknown,
    isLoading: false,
    isFetching: false,
    error: null as Error | null,
  },
}));
const byIdState = vi.hoisted(() => ({
  current: { data: undefined as unknown, error: null as Error | null },
}));
const routerState = vi.hoisted(() => ({
  query: {} as Record<string, string>,
  replace: vi.fn(),
}));
const mutations = vi.hoisted(() => ({
  approveDomainClaim: vi.fn(),
  rejectDomainClaim: vi.fn(),
  attestDomain: vi.fn(),
  activate: vi.fn(),
  suspend: vi.fn(),
  resume: vi.fn(),
  requestTeardown: vi.fn(),
}));

vi.mock("../../../behavior/ops-api", () => {
  const mutation = (name: keyof typeof mutations) => ({
    useMutation: () => ({ mutate: mutations[name] }),
  });
  return {
    api: {
      useContext: () => ({ ssoConnections: { invalidate: vi.fn() } }),
      ssoConnections: {
        getAll: { useQuery: () => listState.current },
        getById: {
          useQuery: (_input: unknown, opts?: { enabled?: boolean }) =>
            opts?.enabled ? byIdState.current : { data: undefined, error: null },
        },
        approveDomainClaim: mutation("approveDomainClaim"),
        rejectDomainClaim: mutation("rejectDomainClaim"),
        attestDomain: mutation("attestDomain"),
        activate: mutation("activate"),
        suspend: mutation("suspend"),
        resume: mutation("resume"),
        requestTeardown: mutation("requestTeardown"),
      },
    },
  };
});

vi.mock("../../../behavior/ops-router", () => ({
  useOpsRouter: () => ({
    query: routerState.query,
    replace: routerState.replace,
  }),
}));

vi.mock("~/components/ui/toaster", () => ({ toaster: { create: vi.fn() } }));

const ATTESTED = {
  connectionId: "ssoc_1",
  organizationId: "org_acme",
  organizationName: "Acme",
  type: "oidc",
  state: "ACTIVE",
  claimedDomains: [] as string[],
  approvedDomains: [] as string[],
  verifiedDomains: ["acme.com"],
  domainVerifications: [
    {
      domain: "acme.com",
      method: "operator-attested",
      actorId: "user_olive",
      verifiedAtMs: new Date("2026-08-24T10:00:00Z").getTime(),
    },
  ],
  providerId: "okta",
  issuer: "https://login.acme.okta.com",
  allowsJit: true,
  source: "self-serve",
  testLoginAccountId: "acc_test",
  rejection: null,
  pendingVerificationDomain: null,
  createdAtMs: new Date("2026-08-24T09:00:00Z").getTime(),
  updatedAtMs: new Date("2026-08-24T10:00:00Z").getTime(),
};

/** A second connection whose organization no longer resolves to a name. */
const UNRESOLVABLE = {
  ...ATTESTED,
  connectionId: "ssoc_2",
  organizationId: "org_ghost",
  organizationName: null,
  verifiedDomains: ["ghost.example"],
  domainVerifications: [{ ...ATTESTED.domainVerifications[0]!, domain: "ghost.example" }],
};

function renderView() {
  return renderWithOpsHost(<SsoConnectionsView />);
}

beforeEach(() => {
  vi.clearAllMocks();
  routerState.query = {};
  listState.current = {
    data: { connections: [ATTESTED], total: 1 },
    isLoading: false,
    isFetching: false,
    error: null,
  };
  byIdState.current = { data: ATTESTED, error: null };
});

describe("the back-office single sign-on list", () => {
  describe("when an operator opens it", () => {
    /** @scenario "The connection list behaves like every other back-office list" */
    it("searches, pages and shows its loading and empty states like the other lists", async () => {
      const { rerenderWithOpsHost } = renderView();

      // Search: the shared shell's input, and it filters the list rather than
      // being decoration.
      const search = screen.getByPlaceholderText("Search by connection, organization or domain");
      fireEvent.change(search, { target: { value: "acme" } });
      expect((search as HTMLInputElement).value).toBe("acme");

      // Paging: the shared shell's range readout, from the query's total.
      listState.current = {
        ...listState.current,
        data: { connections: [ATTESTED], total: 60 },
      };
      rerenderWithOpsHost(<SsoConnectionsView />);
      await waitFor(() => {
        expect(screen.getByText(/of 60/)).toBeTruthy();
      });

      // Empty state: its own row, in the table, saying what would change it.
      listState.current = {
        ...listState.current,
        data: { connections: [], total: 0 },
      };
      rerenderWithOpsHost(<SsoConnectionsView />);
      await waitFor(() => {
        expect(screen.getByText("No single sign-on connections match your search.")).toBeTruthy();
      });

      // Loading state: the shell's spinner, not a bespoke one.
      listState.current = {
        data: undefined,
        isLoading: true,
        isFetching: true,
        error: null,
      };
      rerenderWithOpsHost(<SsoConnectionsView />);
      await waitFor(() => {
        expect(screen.queryByText("No single sign-on connections match your search.")).toBeNull();
      });
    });

    /** @scenario "What proved the domain is on the connection wherever it is read" */
    it("says on the row that an attested domain was attested, never that the customer proved it", () => {
      renderView();

      expect(screen.getByText("Attested by LangWatch")).toBeTruthy();
      expect(screen.queryByText("Published record")).toBeNull();
    });

    /** @scenario "The connection list behaves like every other back-office list" */
    it("puts each row's actions in that row's overflow menu, with removal set apart", async () => {
      renderView();

      const trigger = screen.getByLabelText("Actions for Acme");
      fireEvent.click(trigger);

      await waitFor(() => {
        expect(screen.getByText("Pause")).toBeTruthy();
      });
      // Removal is in the same menu and tinted as destructive, one deliberate
      // click away rather than an inline button beside the row's content.
      const remove = screen.getByText("Remove");
      expect(remove).toBeTruthy();
      expect((remove.closest("[data-scope='menu']") ?? remove).textContent).toContain("Remove");
    });
  });

  describe("when an operator starts removing a live connection", () => {
    /** @scenario "Removing a live connection states its own risk before it happens" */
    it("names the organization and who would lose their way in", async () => {
      renderView();

      fireEvent.click(screen.getByLabelText("Actions for Acme"));
      await waitFor(() => screen.getByText("Remove"));
      fireEvent.click(screen.getByText("Remove"));

      await waitFor(() => {
        expect(screen.getByText("Remove single sign-on for Acme?")).toBeTruthy();
      });
      // The blast radius in the operator's terms: the organization by name,
      // the domain, and what happens to the people behind it.
      const risk = screen.getByText(/Everyone at Acme who signs in/);
      expect(risk.textContent).toContain("acme.com");
      expect(risk.textContent).toContain("cannot get in at all");
      // Nothing is commanded by opening the confirmation.
      expect(mutations.requestTeardown).not.toHaveBeenCalled();
    });

    /** @scenario "Removing a live connection states its own risk before it happens" */
    it("withholds the removal outright when the organization's name cannot be resolved", async () => {
      listState.current = {
        ...listState.current,
        data: { connections: [UNRESOLVABLE], total: 1 },
      };
      renderView();

      fireEvent.click(screen.getByLabelText("Actions for ssoc_2"));
      await waitFor(() => screen.getByText("Remove"));
      fireEvent.click(screen.getByText("Remove"));

      await waitFor(() => {
        expect(screen.getByText("This organization cannot be identified")).toBeTruthy();
      });
      // No confirm button at all — a confirmation against an identifier the
      // operator cannot check is not a confirmation.
      expect(
        screen.queryAllByRole("button").filter((button) => button.textContent === "Remove"),
      ).toHaveLength(0);
      expect(mutations.requestTeardown).not.toHaveBeenCalled();
    });
  });

  describe("when an operator opens a connection from the list", () => {
    /** @scenario "A connection's detail opens beside the list, not on a page of its own" */
    it("opens its state, domains, provider reference and history in a drawer over the list", async () => {
      routerState.query = { connection: "ssoc_1" };
      renderView();

      await waitFor(() => {
        expect(screen.getAllByText("okta").length).toBeGreaterThan(0);
      });
      // The drawer's facts.
      expect(screen.getByText("https://login.acme.okta.com")).toBeTruthy();
      expect(screen.getByText("OIDC")).toBeTruthy();
      // The history of what proved the domain, naming the operator and when.
      expect(screen.getByText(/user_olive/)).toBeTruthy();

      // The list is still mounted underneath: the drawer is beside it, not a
      // page that replaced it.
      expect(
        screen.getByPlaceholderText("Search by connection, organization or domain"),
      ).toBeTruthy();
    });

    /** @scenario "A connection's detail opens beside the list, not on a page of its own" */
    it("returns to the list where it was when the drawer closes", async () => {
      routerState.query = { connection: "ssoc_1", q: "acme" };
      renderView();

      await waitFor(() => {
        expect(screen.getAllByText("okta").length).toBeGreaterThan(0);
      });
      fireEvent.click(screen.getByLabelText(/close/i));

      // Closing pops only the drawer's own parameter. Everything else the
      // list was showing — the search it was filtered by — survives the
      // return trip, so the operator lands back where they were.
      await waitFor(() => {
        expect(routerState.replace).toHaveBeenCalled();
      });
      const [[destination, , options]] = routerState.replace.mock.calls as unknown as [
        [{ query: Record<string, unknown> }, undefined, { shallow: boolean }],
      ];
      expect(destination.query).toEqual({ q: "acme" });
      expect(options.shallow).toBe(true);
    });
  });
});
