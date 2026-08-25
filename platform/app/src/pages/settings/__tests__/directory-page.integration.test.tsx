/**
 * @vitest-environment jsdom
 *
 * The Directory page: named for what it holds, leading with its status, with
 * groups and tokens as tabs under it.
 *
 * Spec: specs/identity/org-access-cluster.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  /** What `hasPermission` answers, so a reader can hold one half and not the
   *  other — the split the page is built around. */
  permissions: new Set<string>(),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org_acme", name: "Acme", teams: [] },
    hasPermission: (permission: string) => state.permissions.has(permission),
  }),
}));

vi.mock("~/components/SettingsLayout", () => ({
  default: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="settings-layout">{children}</div>
  ),
}));

// The reconciliation panel, the summary band and the groups list all have
// their own tests; here they only have to be present and in the right place.
vi.mock("~/components/settings/ScimReconciliationPanel", () => ({
  ScimReconciliationPanel: () => (
    <div data-testid="reconciliation-panel">connections</div>
  ),
}));

vi.mock("~/components/access/DirectorySummary", () => ({
  DirectorySummary: () => <div data-testid="directory-summary">status</div>,
}));

vi.mock("~/components/access/DirectoryMembersSection", () => ({
  DirectoryMembersSection: () => (
    <div data-testid="directory-managed-members">people</div>
  ),
}));

vi.mock("~/components/access/GroupsSection", () => ({
  GroupsSection: () => <div data-testid="groups-section">groups</div>,
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      scimToken: { list: { invalidate: vi.fn() } },
      scimReconciliation: { invalidate: vi.fn() },
    }),
    scimToken: {
      list: { useQuery: () => ({ data: [] }) },
      generate: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      revoke: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    scimReconciliation: {
      getAll: {
        useQuery: () => ({
          data: { connections: [], recentChanges: [] },
          isLoading: false,
          isError: false,
          error: null,
        }),
      },
    },
  },
}));

const DirectoryPage = (await import("../directory")).default;

function renderPage(initialEntry = "/settings/directory") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ChakraProvider value={defaultSystem}>
        <DirectoryPage />
      </ChakraProvider>
    </MemoryRouter>,
  );
}

describe("given the directory page", () => {
  beforeEach(() => {
    state.permissions = new Set([
      "sso:view",
      "sso:manage",
      "organization:manage",
    ]);
  });
  afterEach(() => cleanup());

  describe("when an administrator opens it", () => {
    /** @scenario The page leads with whether it is working */
    it("puts the status above the tabs, so every tab is read against it", () => {
      renderPage();

      const summary = screen.getByTestId("directory-summary");
      const tabs = screen.getByRole("tab", { name: "Overview" });
      expect(
        summary.compareDocumentPosition(tabs) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    /** @scenario The page leads with whether it is working */
    it("opens on the overview, which carries the connection detail", () => {
      const { container } = renderPage();

      expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(screen.getByTestId("reconciliation-panel")).toBeInTheDocument();
      expect(container.textContent).toContain(
        "Where your identity provider sends it",
      );
    });

    /** @scenario The protocol keeps its name in the body copy */
    it("is called Directory, and still says SCIM for the reader who searched for it", () => {
      const { container } = renderPage();

      expect(
        screen.getByRole("heading", { name: "Directory" }),
      ).toBeInTheDocument();
      // The protocol is what an IT administrator searched for. It survives in
      // the words on the page even though the navigation entry does not.
      expect(container.textContent).toContain("SCIM");
    });

    it("offers the overview, the groups and the tokens as three tabs", () => {
      renderPage();

      expect(screen.getByRole("tab", { name: "Overview" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Groups" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Tokens" })).toBeInTheDocument();
    });
  });

  describe("when the address names the groups tab", () => {
    /** @scenario The groups tab holds the hand-made ones as well as the sent ones */
    it("opens on the groups, which is where the old address forwards to", () => {
      renderPage("/settings/directory?tab=groups");

      expect(screen.getByRole("tab", { name: "Groups" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(screen.getByTestId("groups-section")).toBeInTheDocument();
    });
  });

  describe("when the reader may see the sync but not manage the organization", () => {
    /** @scenario A reader who may not read groups is told nothing they cannot have */
    it("offers no groups tab at all rather than one that refuses them", () => {
      state.permissions = new Set(["sso:view"]);
      renderPage();

      expect(screen.queryByRole("tab", { name: "Groups" })).toBeNull();
      expect(screen.getByRole("tab", { name: "Overview" })).toBeInTheDocument();
    });

    it("keeps the groups tab shut even when the address asks for it", () => {
      state.permissions = new Set(["sso:view"]);
      renderPage("/settings/directory?tab=groups");

      expect(screen.queryByTestId("groups-section")).toBeNull();
      expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });

    /** @scenario "A reader who may not read membership is not shown a roster" */
    it("leaves out the roster, which reads the membership they may not have", () => {
      state.permissions = new Set(["sso:view"]);
      renderPage();

      expect(screen.queryByTestId("directory-managed-members")).toBeNull();
      // The half of the overview they may read is still there.
      expect(screen.getByTestId("reconciliation-panel")).toBeInTheDocument();
    });
  });

  describe("when the reader may manage the organization but not see the sync", () => {
    it("keeps the page open on the half they came for", () => {
      state.permissions = new Set(["organization:manage"]);
      renderPage("/settings/directory?tab=groups");

      expect(screen.getByTestId("groups-section")).toBeInTheDocument();
      expect(screen.queryByRole("tab", { name: "Overview" })).toBeNull();
      // The status band reads the sync, which this reader may not.
      expect(screen.queryByTestId("directory-summary")).toBeNull();
    });
  });

  describe("when the reader holds neither permission", () => {
    it("refuses the page rather than drawing an empty one", () => {
      state.permissions = new Set();
      renderPage();

      expect(screen.queryByRole("tab", { name: "Overview" })).toBeNull();
      expect(screen.queryByTestId("groups-section")).toBeNull();
      expect(screen.queryByRole("heading", { name: "Directory" })).toBeNull();
    });
  });
});
