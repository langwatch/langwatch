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
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockUseOrganizationTeamProject,
  mockReconciliation,
  mockTokenList,
  mockRequests,
} = vi.hoisted(() => ({
  mockUseOrganizationTeamProject: vi.fn(),
  mockReconciliation: vi.fn(),
  mockTokenList: vi.fn(),
  mockRequests: vi.fn(),
}));

const apiDouble = {
  api: {
    scimReconciliation: {
      getAll: { useQuery: mockReconciliation },
      // What the identity provider asked and what we answered (ADR-126),
      // beside the state the panel already read.
      getRequests: { useQuery: mockRequests },
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
    team: {
      getTeamsWithRoleBindings: {
        useQuery: () => ({
          data: [],
          isLoading: false,
          isError: false,
          error: null,
        }),
      },
    },
    joinRequests: {
      pending: {
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
      getOrganizationWithMembersAndTheirTeams: {
        useQuery: () => ({
          data: { members: [] },
          isLoading: false,
          isError: false,
          error: null,
        }),
      },
      getOrganizationPendingInvites: {
        useQuery: () => ({
          data: [],
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
  mockRequests.mockReturnValue({ data: [], isLoading: false });
  readerHolding(["sso:view", "sso:manage"]);
});

describe("the directory provisioning page", () => {
  describe("when an administrator opens it", () => {
    /** @scenario "A connection's sync state is on the SCIM settings page" */
    it("lists each connection with its current state, said in words", async () => {
      const { ScimReconciliationPanel } = await import(
        "../../../components/settings/ScimReconciliationPanel"
      );

      draw(
        <ScimReconciliationPanel
          organizationId="org_acme"
          maySetUpSingleSignOn={true}
        />,
      );

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

      draw(
        <ScimReconciliationPanel
          organizationId="org_acme"
          maySetUpSingleSignOn={true}
        />,
      );

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

      draw(
        <ScimReconciliationPanel
          organizationId="org_acme"
          maySetUpSingleSignOn={true}
        />,
      );

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

      draw(
        <ScimReconciliationPanel
          organizationId="org_acme"
          maySetUpSingleSignOn={true}
        />,
      );

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
        <ScimReconciliationPanel
          organizationId="org_acme"
          maySetUpSingleSignOn={true}
        />,
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

      draw(
        <ScimReconciliationPanel
          organizationId="org_acme"
          maySetUpSingleSignOn={true}
        />,
      );

      // Not disabled — absent. There is no button on this panel at all.
      expect(screen.queryAllByRole("button")).toEqual([]);
      expect(
        screen.getAllByText(
          /next push re-asserts everything it still believes/i,
        ).length,
      ).toBeGreaterThan(0);
    });
  });

  /**
   * The state the page opens in for an organization that has not started.
   * It used to be a paragraph saying a connection is the first step, with no
   * way to take it — the reader was handed a fact and left holding it.
   */
  describe("given an organization with no connection at all", () => {
    beforeEach(() => {
      mockReconciliation.mockReturnValue({
        data: { connections: [], recentChanges: [] },
        isLoading: false,
      });
    });

    /** @scenario "An organization with no connection is offered the way to set one up" */
    it("offers the first step rather than only naming it", async () => {
      const { ScimReconciliationPanel } = await import(
        "../../../components/settings/ScimReconciliationPanel"
      );

      draw(
        <ScimReconciliationPanel
          organizationId="org_acme"
          maySetUpSingleSignOn={true}
        />,
      );

      const empty = screen.getByTestId("directory-no-connection");
      expect(empty.textContent).toContain("No identity provider is connected");
      const step = within(empty).getByRole("link", {
        name: "Set up single sign-on",
      });
      expect(step.getAttribute("href")).toBe("/settings/authentication");
    });

    /** @scenario "The first step is not offered to somebody who would be refused it" */
    it("offers nobody a step they would be refused for", async () => {
      const { ScimReconciliationPanel } = await import(
        "../../../components/settings/ScimReconciliationPanel"
      );

      draw(
        <ScimReconciliationPanel
          organizationId="org_acme"
          maySetUpSingleSignOn={false}
        />,
      );

      const empty = screen.getByTestId("directory-no-connection");
      expect(within(empty).queryByRole("link")).toBeNull();
      // Told who does it, rather than left wondering why there is no button.
      expect(empty.textContent).toContain("An administrator who manages");
    });
  });

  describe("given somebody who may see single sign-on but not manage it", () => {
    /** @scenario "Seeing sync status and managing tokens are two different permissions" */
    /** @scenario "Reading the requests takes seeing single sign-on, and writes nothing" */
    /** @scenario "Seeing the sequence takes the same permission as seeing the state" */
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
      const { default: ConnectorsPage } = await import(
        "../authentication/connectors"
      );

      // The tokens live with the connectors they authorise, on
      // Authentication — whether a connector is syncing and what credential
      // it syncs with are both about how people ARRIVE.
      draw(<ConnectorsPage />, "/settings/authentication/connectors");

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
      const { default: ConnectorsPage } = await import(
        "../authentication/connectors"
      );

      draw(<ConnectorsPage />, "/settings/authentication/connectors");

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
        <ScimReconciliationPanel
          organizationId="org_acme"
          maySetUpSingleSignOn={true}
        />,
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

/**
 * The requests half of ADR-126.
 *
 * The panel above reads the sync LOG, which carries what the directory
 * decided. A push refused before it reached a handler decided nothing, so it
 * appends no fact and is invisible there — and that refusal is precisely what
 * somebody who has just pasted a token needs to see. These drive the surface
 * that closes the gap.
 */
describe("given a connection the directory has been pushing to", () => {
  describe("when requests have been recorded", () => {
    /** @scenario "The requests a connection has served are on the SCIM settings page" */
    it("reads them, refusals in our own words", async () => {
      mockRequests.mockReturnValue({
        data: [
          {
            id: "req_2",
            method: "POST",
            resource: "Users",
            status: 400,
            reason: "invalid_resource",
            detail: "The resource is not valid: externalId",
            occurredAt: new Date("2026-08-26T10:10:52.000Z"),
          },
        ],
        isLoading: false,
      });

      const { ScimReconciliationPanel } = await import(
        "../../../components/settings/ScimReconciliationPanel"
      );
      draw(
        <ScimReconciliationPanel
          organizationId="org_acme"
          maySetUpSingleSignOn={true}
        />,
      );

      // The fixture has more than one running connection, and each card
      // carries its own list. The first is this connection's.
      const [requests] = screen.getAllByTestId("directory-requests");
      if (!requests) throw new Error("no requests list rendered");
      // "users", not "Users" and never "Users/:id": the stored form keeps a
      // routing convention so rows group, and a person reading their
      // directory's activity has no reason to know it.
      expect(within(requests).getByText(/POST users/)).toBeTruthy();
      expect(within(requests).getByText("Refused")).toBeTruthy();
      expect(
        within(requests).getByText(/The resource is not valid: externalId/),
      ).toBeTruthy();
      // The slug is what a reader BRANCHES on, never what they read.
      expect(within(requests).queryByText("invalid_resource")).toBeNull();
    });
  });

  describe("when nothing has come through the connection yet", () => {
    /** @scenario "A connection nothing has happened on says so rather than drawing an empty list" */
    it("says what it holds, rather than drawing a list with nothing in it", async () => {
      mockRequests.mockReturnValue({ data: [], isLoading: false });

      const { ScimReconciliationPanel } = await import(
        "../../../components/settings/ScimReconciliationPanel"
      );
      draw(
        <ScimReconciliationPanel
          organizationId="org_acme"
          maySetUpSingleSignOn={true}
        />,
      );

      const [requests] = screen.getAllByTestId("directory-requests");
      if (!requests) throw new Error("no requests list rendered");
      // Requests age out of a retention window, so the words are about what
      // this holds rather than about what the provider has ever sent. Only
      // one of those two is ours to assert.
      expect(
        within(requests).getByText(/No requests recorded/i),
      ).toBeTruthy();
      expect(within(requests).getByText(/thirty days/i)).toBeTruthy();
    });
  });

  describe("when a refusal was recorded with no sentence of its own", () => {
    it("still says what kind of refusal it was", async () => {
      // The recorder writes `detail` only where a handler composed one. A row
      // that carries the slug and nothing else renders as an orange badge and
      // no words, which is the question this surface exists to answer.
      mockRequests.mockReturnValue({
        data: [
          {
            id: "req_3",
            method: "POST",
            resource: "Users",
            status: 403,
            reason: "plan_not_entitled",
            detail: null,
            occurredAt: new Date("2026-08-26T10:11:00.000Z"),
          },
        ],
        isLoading: false,
      });

      const { ScimReconciliationPanel } = await import(
        "../../../components/settings/ScimReconciliationPanel"
      );
      draw(
        <ScimReconciliationPanel
          organizationId="org_acme"
          maySetUpSingleSignOn={true}
        />,
      );

      const [requests] = screen.getAllByTestId("directory-requests");
      if (!requests) throw new Error("no requests list rendered");
      expect(
        within(requests).getByText(/plan no longer includes directory sync/i),
      ).toBeTruthy();
      expect(within(requests).queryByText("plan_not_entitled")).toBeNull();
    });
  });

  describe("when the requests could not be read at all", () => {
    it("says so rather than reporting that nothing was ever sent", async () => {
      // An absent row is not a denial — this component's own promise. On a
      // failed read the empty state makes exactly that denial, to the one
      // reader trying to find out whether their provider reached us.
      mockRequests.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
        error: new Error("the log could not be read"),
      });

      const { ScimReconciliationPanel } = await import(
        "../../../components/settings/ScimReconciliationPanel"
      );
      draw(
        <ScimReconciliationPanel
          organizationId="org_acme"
          maySetUpSingleSignOn={true}
        />,
      );

      const [requests] = screen.getAllByTestId("directory-requests");
      if (!requests) throw new Error("no requests list rendered");
      expect(within(requests).queryByText(/No requests recorded/)).toBeNull();
    });
  });

  describe("when nothing has been recorded", () => {
    /** @scenario "An absent request is not evidence that it never happened" */
    it("says what it holds rather than that nothing was ever sent", async () => {
      mockRequests.mockReturnValue({ data: [], isLoading: false });

      const { ScimReconciliationPanel } = await import(
        "../../../components/settings/ScimReconciliationPanel"
      );
      draw(
        <ScimReconciliationPanel
          organizationId="org_acme"
          maySetUpSingleSignOn={true}
        />,
      );

      // The fixture has more than one running connection, and each card
      // carries its own list. The first is this connection's.
      const [requests] = screen.getAllByTestId("directory-requests");
      if (!requests) throw new Error("no requests list rendered");
      expect(within(requests).getByText(/thirty days/i)).toBeTruthy();
      expect(
        within(requests).queryByText(/has never sent|nothing was sent/i),
      ).toBeNull();
    });
  });
});

describe("given a token nothing has ever presented", () => {
  /** @scenario "A token nothing has presented says so, rather than only showing a date that is missing" */
  it("says nothing has presented it, in words pointing at the provider", async () => {
    readerHolding(["sso:view", "sso:manage"]);
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
    const { default: ConnectorsPage } = await import(
      "../authentication/connectors"
    );

    draw(<ConnectorsPage />, "/settings/authentication/connectors");

    // A mistyped token is the most common setup failure there is and can
    // never reach the request list, so this badge is the whole remedy — and
    // a bare "Never" leaves the reader to infer it.
    expect(
      screen.getByText(/Nothing has presented this token yet/),
    ).toBeTruthy();
    expect(screen.getByText(/check the token it is using/)).toBeTruthy();
  });
});
