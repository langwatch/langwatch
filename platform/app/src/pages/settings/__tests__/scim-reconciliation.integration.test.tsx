/**
 * @vitest-environment jsdom
 *
 * What an administrator reads on the directory provisioning page, and what
 * they are offered (ADR-122 — see
 * specs/identity/scim-reconciliation-surfaces.feature).
 *
 * The panel is a READ: every word on it comes from the server, which built it
 * from the sync projection, the mapping count and the grants facts the
 * directory authored. So what this test drives is the rendering half of those
 * promises — the state in words, the last push and the count, a connection
 * that has never been pushed to reading calmly, a removal attributed to the
 * directory, a failure as words with no code and no record identifier, and
 * the absence of any control that would re-run it.
 *
 * The two permissions are the other half: a reader who may see single sign-on
 * gets the whole panel and is offered nothing they would be refused for.
 *
 * The settings chrome is stubbed to a passthrough. What is under test is the
 * panel and the page's own gating; the layout would drag the whole navigation
 * tree in to prove neither.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUseOrganizationTeamProject, mockReconciliation, mockTokenList } =
  vi.hoisted(() => ({
    mockUseOrganizationTeamProject: vi.fn(),
    mockReconciliation: vi.fn(),
    mockTokenList: vi.fn(),
  }));

const apiDouble = {
  api: {
    scimReconciliation: {
      getAll: { useQuery: mockReconciliation },
    },
    // The page leads with a status strip that counts the groups the directory
    // sent and the members it does not manage, and the groups tab lists them.
    // None of that is this file's subject; all of it has to be answerable or
    // the page cannot render.
    group: {
      listAll: {
        useQuery: () => ({
          data: [],
          isLoading: false,
          isError: false,
          error: null,
        }),
      },
    },
    organization: {
      getMemberProvenance: {
        useQuery: () => ({
          data: {},
          isLoading: false,
          isError: false,
          error: null,
        }),
      },
    },
    scimToken: {
      list: { useQuery: mockTokenList },
      generate: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      revoke: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    useUtils: () => ({
      scimToken: { list: { invalidate: vi.fn() } },
      scimReconciliation: { invalidate: vi.fn() },
    }),
  },
};

const hookDouble = {
  useOrganizationTeamProject: mockUseOrganizationTeamProject,
};

vi.mock("~/hooks/useOrganizationTeamProject", () => hookDouble);
vi.mock("../../../hooks/useOrganizationTeamProject", () => hookDouble);
vi.mock("~/utils/api", () => apiDouble);
vi.mock("../../../utils/api", () => apiDouble);
vi.mock("../../../components/SettingsLayout", () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const T0 = 1_756_000_000_000;

/** What the server hands the page for an organization with two connections:
 *  one syncing with a standing failure, one nobody has pushed to yet. */
const PANEL = {
  connections: [
    {
      connectionId: "acme-okta",
      providerId: "okta",
      verifiedDomains: ["acme.com"],
      state: "ERROR",
      status: {
        headline: "Something the directory asked for has not been applied",
        waitingFor:
          "Your identity provider's next push re-asserts everything it still believes, so fixing this in the directory is what puts it right.",
        tone: "attention",
      },
      lastPushedAtMs: T0,
      managedPeople: 12,
      failures: [
        {
          title: "We could not finish removing someone's access",
          description: "Ask an administrator to check what they still hold.",
          occurredAtMs: T0 + 1_000,
          retired: true,
        },
      ],
      remediation:
        "Your identity provider's next push re-asserts everything it still believes, so fixing this in the directory is what puts it right.",
    },
    {
      connectionId: "acme-entra",
      providerId: "entra",
      verifiedDomains: [],
      state: null,
      status: {
        headline: "Not set up yet",
        waitingFor:
          "No directory token has been issued for this connection. Issue one and point your identity provider at it to start provisioning.",
        tone: "waiting",
      },
      lastPushedAtMs: null,
      managedPeople: 0,
      failures: [],
      remediation:
        "Your identity provider's next push re-asserts everything it still believes, so fixing this in the directory is what puts it right.",
    },
  ],
  recentChanges: [
    {
      grantId: "grant_sam_member",
      summary: "Sam Patel lost access",
      author: "Your identity provider",
      occurredAtMs: T0 + 2_000,
      kind: "removed",
    },
  ],
};

/** A reader holding exactly the permissions named, and nothing else. */
function readerHolding(permissions: string[]): void {
  const holds = (permission: string) => permissions.includes(permission);
  mockUseOrganizationTeamProject.mockReturnValue({
    isLoading: false,
    organization: { id: "org_acme", name: "Acme" },
    hasPermission: holds,
    hasAnyPermission: holds,
    hasOrganizationPermission: holds,
    hasTeamPermission: holds,
  });
}

const draw = (node: ReactNode, address = "/settings/directory") =>
  render(
    <MemoryRouter initialEntries={[address]}>
      <ChakraProvider value={defaultSystem}>{node}</ChakraProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mockReconciliation.mockReturnValue({ data: PANEL, isLoading: false });
  mockTokenList.mockReturnValue({ data: [], isLoading: false });
  readerHolding(["sso:view", "sso:manage"]);
});

describe("the directory provisioning page", () => {
  describe("when an administrator opens it", () => {
    /** @scenario "A connection's sync state is on the SCIM settings page" */
    it("lists each connection with its current state, said in words", async () => {
      const { ScimReconciliationPanel } = await import(
        "../../../components/settings/ScimReconciliationPanel"
      );

      draw(<ScimReconciliationPanel organizationId="org_acme" />);

      expect(screen.getByText("okta")).toBeTruthy();
      expect(
        screen.getByText(
          "Something the directory asked for has not been applied",
        ),
      ).toBeTruthy();
      // No lifecycle name reaches the reader anywhere on the page.
      expect(screen.queryByText(/TOKEN_ISSUED|SYNCING|REVOKED/)).toBeNull();
    });

    /** @scenario "The last push and the people managed are counted per connection" */
    it("shows when the directory last pushed and how many people it manages", async () => {
      const { ScimReconciliationPanel } = await import(
        "../../../components/settings/ScimReconciliationPanel"
      );

      draw(<ScimReconciliationPanel organizationId="org_acme" />);

      // One per connection: both are labelled, and only one has a date.
      expect(screen.getAllByText("Last push from the directory")).toHaveLength(
        2,
      );
      expect(screen.getByText(new Date(T0).toLocaleString())).toBeTruthy();
      expect(screen.getAllByText("People this directory manages")).toHaveLength(
        2,
      );
      expect(screen.getByText("12")).toBeTruthy();
    });

    /** @scenario "A connection the directory has never pushed to says so calmly" */
    it("reads a connection with no push yet as waiting, with nothing reading as an error", async () => {
      const { ScimReconciliationPanel } = await import(
        "../../../components/settings/ScimReconciliationPanel"
      );

      draw(<ScimReconciliationPanel organizationId="org_acme" />);

      expect(screen.getByText("Not set up yet")).toBeTruthy();
      expect(screen.getByText("No push yet")).toBeTruthy();
      // The word "failed" belongs to the connection that failed, and nothing
      // about the untouched one borrows it.
      expect(screen.queryByText(/entra.*(failed|error)/i)).toBeNull();
    });
  });

  describe("when the directory has removed somebody", () => {
    /** @scenario "People the directory removed are listed as the directory's act" */
    it("lists them with the directory named as the author and when it happened", async () => {
      const { ScimReconciliationPanel } = await import(
        "../../../components/settings/ScimReconciliationPanel"
      );

      draw(<ScimReconciliationPanel organizationId="org_acme" />);

      expect(screen.getByText("Sam Patel lost access")).toBeTruthy();
      expect(screen.getByText("Removed")).toBeTruthy();
      expect(
        screen.getByText(
          `Your identity provider · ${new Date(T0 + 2_000).toLocaleString()}`,
        ),
      ).toBeTruthy();
    });
  });

  describe("when the directory's last push contained something that could not be applied", () => {
    /** @scenario "A failed apply reaches the administrator as words to act on" */
    it("says what happened and what resolves it, with no code and no record identifier", async () => {
      const { ScimReconciliationPanel } = await import(
        "../../../components/settings/ScimReconciliationPanel"
      );

      const { container } = draw(
        <ScimReconciliationPanel organizationId="org_acme" />,
      );

      expect(
        screen.getByText("We could not finish removing someone's access"),
      ).toBeTruthy();
      expect(
        screen.getByText("Ask an administrator to check what they still hold."),
      ).toBeTruthy();
      // Nothing internal is rendered: no reason code, no identifier for the
      // record behind it.
      expect(container.textContent).not.toContain("offboard_incomplete");
      expect(container.textContent).not.toContain("grant_");
    });

    /** @scenario "The organization view offers no retry" */
    it("offers no control that would re-run it, and says the next push is what re-asserts it", async () => {
      const { ScimReconciliationPanel } = await import(
        "../../../components/settings/ScimReconciliationPanel"
      );

      draw(<ScimReconciliationPanel organizationId="org_acme" />);

      // Not disabled — absent. There is no button on this panel at all.
      expect(screen.queryAllByRole("button")).toEqual([]);
      expect(
        screen.getAllByText(
          /next push re-asserts everything it still believes/i,
        ).length,
      ).toBeGreaterThan(0);
    });
  });

  describe("given somebody who may see single sign-on but not manage it", () => {
    /** @scenario "Seeing sync status and managing tokens are two different permissions" */
    it("reads the panel normally and is offered no minting or revoking control", async () => {
      readerHolding(["sso:view"]);
      mockTokenList.mockReturnValue({
        data: [
          {
            id: "scimtok_1",
            description: "Okta production",
            connectionId: "acme-okta",
            createdAt: new Date(T0),
            lastUsedAt: null,
          },
        ],
        isLoading: false,
      });
      const { default: DirectoryPage } = await import("../directory");

      // The tokens are a tab of the Directory page now, so the address names
      // it — the same address the tab writes when a reader opens it.
      draw(<DirectoryPage />, "/settings/directory?tab=tokens");

      // The panel reads normally — the connection appears both in the panel
      // and in the token listing's connection column.
      expect(screen.getAllByText("okta").length).toBeGreaterThan(0);
      expect(screen.getByText("Sam Patel lost access")).toBeTruthy();
      // And no control they would be refused for is rendered at all.
      expect(screen.queryByRole("button", { name: /issue token/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /revoke/i })).toBeNull();
    });

    it("offers the controls to somebody who may manage it", async () => {
      readerHolding(["sso:view", "sso:manage"]);
      const { default: DirectoryPage } = await import("../directory");

      draw(<DirectoryPage />, "/settings/directory?tab=tokens");

      expect(screen.getByRole("button", { name: /issue token/i })).toBeTruthy();
    });
  });

  describe("given another organization's connection", () => {
    /** @scenario "Another organization's connection is not there to read" */
    it("lists nothing that did not come back for this organization", async () => {
      const { ScimReconciliationPanel } = await import(
        "../../../components/settings/ScimReconciliationPanel"
      );

      const { container } = draw(
        <ScimReconciliationPanel organizationId="org_acme" />,
      );

      // The page renders exactly what the organization-scoped query returned,
      // and asks for it by organization — it holds no way to name another
      // one, which is the same rule the service enforces at the data layer.
      expect(container.textContent).not.toContain("globex");
      expect(mockReconciliation).toHaveBeenCalledWith({
        organizationId: "org_acme",
      });
    });
  });
});
