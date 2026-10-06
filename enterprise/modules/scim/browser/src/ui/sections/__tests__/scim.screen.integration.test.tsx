/**
 * @vitest-environment jsdom
 *
 * Tests SCIM settings: IdP endpoint address and authentication token.
 * Critical: token shown exactly once; generate shows plaintext, list never shows secrets.
 */

import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state, calls } = vi.hoisted(() => ({
  state: {
    rows: [] as Record<string, unknown>[],
    connections: [] as {
      connectionId: string;
      displayName: string;
      type: string;
      state: string;
    }[],
    minted: { token: "scim_live_secret_value" },
    members: [] as Record<string, unknown>[],
    provenance: {} as Record<string, { source: string }>,
    membersError: null as Error | null,
    /** Recorded requests, keyed by the tenant AND connection they were asked
     *  for: a feed answered for any other key is a feed nobody may read. */
    requests: {} as Record<string, Record<string, unknown>[]>,
    panel: { connections: [], recentChanges: [] } as {
      connections: Record<string, unknown>[];
      recentChanges: Record<string, unknown>[];
    },
    activity: [] as Record<string, unknown>[],
  },
  calls: { generate: vi.fn(), revoke: vi.fn(), invalidate: vi.fn(), getRequests: vi.fn() },
}));

vi.mock("../../../behavior/scim-api.ts", () => ({
  directoryMembershipApi: {
    organization: {
      getAllOrganizationMembers: {
        useQuery: () => ({
          data: state.members,
          isLoading: false,
          error: state.membersError,
          refetch: vi.fn(),
        }),
      },
      getMemberProvenance: {
        useQuery: () => ({
          data: state.provenance,
          isLoading: false,
          error: null,
          refetch: vi.fn(),
        }),
      },
    },
  },
  scimApi: {
    useUtils: () => ({
      scimToken: { list: { invalidate: calls.invalidate } },
      scimReconciliation: { invalidate: calls.invalidate },
    }),
    scimToken: {
      list: { useQuery: () => ({ data: state.rows, isLoading: false }) },
      connections: { useQuery: () => ({ data: state.connections, isLoading: false }) },
      generate: {
        useMutation: () => ({
          isPending: false,
          mutate: (
            input: unknown,
            options?: { onSuccess?: (result: { token: string }) => void },
          ) => {
            calls.generate(input);
            options?.onSuccess?.(state.minted);
          },
        }),
      },
      revoke: {
        useMutation: () => ({
          isPending: false,
          mutate: (input: unknown, options?: { onSuccess?: () => void }) => {
            calls.revoke(input);
            options?.onSuccess?.();
          },
        }),
      },
    },
    scimReconciliation: {
      getAll: {
        useQuery: () => ({
          data: state.panel,
          isLoading: false,
          isError: false,
        }),
      },
      getActivity: {
        useQuery: () => ({
          data: state.activity,
          isLoading: false,
          isError: false,
          error: null,
          isFetching: false,
          refetch: vi.fn(),
        }),
      },
      getRequests: {
        useQuery: (input: { organizationId: string; connectionId: string }) => {
          calls.getRequests(input);

          return {
            data: state.requests[`${input.organizationId}/${input.connectionId}`] ?? [],
            isLoading: false,
            isError: false,
          };
        },
      },
    },
  },
}));

import { FakeScimHost, renderWithScimHost } from "../../../testing.tsx";
import ConnectorsScreen from "../connectors.screen.tsx";
import ScimScreen from "../scim.screen.tsx";

const token = (overrides: Record<string, unknown> = {}) => ({
  id: "token-1",
  connectionId: "ssoconn_1",
  description: "Okta SCIM integration",
  createdAt: new Date("2026-01-02T00:00:00.000Z"),
  lastUsedAt: null,
  ...overrides,
});

const connection = (
  overrides: Partial<{
    connectionId: string;
    displayName: string;
    type: string;
    state: string;
  }> = {},
) => ({
  connectionId: "ssoconn_1",
  displayName: "Okta",
  type: "saml",
  state: "ACTIVE",
  ...overrides,
});

/** Opens the dialog and answers with its own submit, which mounts a tick later. */
async function openGenerateDialog() {
  fireEvent.click(screen.getByTestId("scim-generate-open"));

  return screen.findByTestId("scim-generate-submit");
}

beforeEach(() => {
  vi.clearAllMocks();
  state.rows = [];
  state.connections = [connection()];
  state.minted = { token: "scim_live_secret_value" };
  state.requests = {};
  state.panel = { connections: [], recentChanges: [] };
  state.activity = [];
  state.members = [];
  state.provenance = {};
  state.membersError = null;
});

afterEach(cleanup);

describe("given no organization is in scope", () => {
  it("renders nothing rather than a page about nothing", () => {
    const { container } = renderWithScimHost(
      <ScimScreen />,
      new FakeScimHost({ organizationId: null }),
    );

    expect(container.textContent).toBe("");
  });
});

describe("given the connectors page inside the Authentication section", () => {
  /** @scenario "The Authentication pages share main's rail" */
  it("frames it in main's rail with Connectors as the current entry", () => {
    renderWithScimHost(<ConnectorsScreen />);

    const rail = screen.getByRole("navigation", { name: "Authentication navigation" });
    const links = within(rail).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Overview", "/settings/authentication"],
      ["Identity provider", "/settings/authentication/provider"],
      ["Connectors", "/settings/authentication/connectors"],
    ]);
    expect(
      within(rail).getByRole("link", { name: "Connectors" }).getAttribute("aria-current"),
    ).toBe("page");
  });
});

describe("given an administrator reads where their provider sends people", () => {
  /** @scenario The protocol keeps its name in the body copy */
  it("names SCIM in the copy while no page or rail entry is titled after it", () => {
    renderWithScimHost(<ConnectorsScreen />);

    expect(screen.getByText(/removes people here on its own, over SCIM/)).toBeTruthy();
    expect(screen.getByText(/talks to us over SCIM/)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Connectors" })).toBeTruthy();
    const rail = screen.getByRole("navigation", { name: "Authentication navigation" });
    for (const link of within(rail).getAllByRole("link")) {
      expect(link.textContent).not.toMatch(/scim/i);
    }
    for (const heading of screen.getAllByRole("heading")) {
      expect(heading.textContent).not.toMatch(/^scim/i);
    }
  });
});

describe("given the identity provider has to be pointed somewhere", () => {
  it("shows the base URL this deployment answers on", () => {
    renderWithScimHost(
      <ScimScreen />,
      new FakeScimHost({ scimBaseUrl: "https://acme.langwatch.test/api/scim/v2" }),
    );

    expect(screen.getByDisplayValue("https://acme.langwatch.test/api/scim/v2")).toBeTruthy();
  });
});

describe("given no token has been generated yet", () => {
  it("says so instead of leaving an empty table", () => {
    renderWithScimHost(<ScimScreen />);

    expect(screen.getByText(/no provisioning token has been issued yet/i)).toBeTruthy();
  });
});

describe("given tokens exist", () => {
  it("lists their metadata and never a secret", () => {
    state.rows = [token()];

    renderWithScimHost(<ScimScreen />);

    expect(screen.getByText("Okta SCIM integration")).toBeTruthy();
    expect(screen.getByText("Never")).toBeTruthy();
    expect(screen.queryByDisplayValue("scim_live_secret_value")).toBeNull();
  });
});

describe("when a token is generated", () => {
  /** @scenario "A single live connection is taken without asking" */
  it("names the connection it provisions for, which the service requires", async () => {
    renderWithScimHost(<ScimScreen />);

    fireEvent.click(await openGenerateDialog());

    expect(calls.generate).toHaveBeenCalledWith({
      organizationId: "org-1",
      connectionId: "ssoconn_1",
      description: void 0,
    });
    expect(await screen.findByDisplayValue("scim_live_secret_value")).toBeTruthy();
  });
});

describe("given the organization has several live connections", () => {
  /** @scenario "Several live connections hold the mint until one is named" */
  it("holds the mint until one of them is named, rather than guessing", async () => {
    state.connections = [
      connection(),
      connection({ connectionId: "ssoconn_2", displayName: "Entra ID" }),
    ];

    renderWithScimHost(<ScimScreen />);

    const submit = await openGenerateDialog();
    expect(submit.hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByLabelText("Connection"), { target: { value: "ssoconn_2" } });
    fireEvent.click(screen.getAllByRole("button", { name: /generate token/i }).at(-1)!);

    expect(calls.generate).toHaveBeenCalledWith({
      organizationId: "org-1",
      connectionId: "ssoconn_2",
      description: void 0,
    });
  });
});

describe("given no connection is live yet", () => {
  /** @scenario "An organization with nothing live says so rather than offering an empty choice" */
  it("says a connection has to come first instead of minting a dead token", async () => {
    state.connections = [connection({ state: "DRAFT" })];

    renderWithScimHost(<ScimScreen />);

    const submit = await openGenerateDialog();

    expect(submit.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/waiting for single sign-on/i)).toBeTruthy();
    fireEvent.click(submit);
    expect(calls.generate).not.toHaveBeenCalled();
  });
});

describe("given a connection that was never turned on", () => {
  /** @scenario "Only live connections are offered when issuing a provisioning token" */
  it("keeps it out of the chooser, where a token against it would sync nobody", async () => {
    state.connections = [
      connection(),
      connection({ connectionId: "ssoconn_2", displayName: "Entra ID", state: "DRAFT" }),
    ];

    renderWithScimHost(<ScimScreen />);
    await openGenerateDialog();

    const options = Array.from(screen.getByLabelText("Connection").querySelectorAll("option")).map(
      (option) => option.textContent,
    );
    expect(options).toEqual(["Choose a connection", "Okta (SAML)"]);
  });
});

describe("given two connections at the same identity provider", () => {
  /** @scenario "Two connections at the same provider are told apart by their protocol" */
  it("names each by the protocol identity recorded, and leaves an unrecorded one alone", async () => {
    state.connections = [
      connection(),
      connection({ connectionId: "ssoconn_2", displayName: "Okta", type: "oidc" }),
      connection({ connectionId: "ssoconn_3", displayName: "Entra ID", type: "" }),
    ];

    renderWithScimHost(<ScimScreen />);
    await openGenerateDialog();

    const options = Array.from(screen.getByLabelText("Connection").querySelectorAll("option")).map(
      (option) => option.textContent,
    );
    expect(options).toEqual(["Choose a connection", "Okta (SAML)", "Okta (OIDC)", "Entra ID"]);
  });
});

describe("given a token issued against a connection since retired", () => {
  /** @scenario "A token issued against a connection since retired still names it" */
  it("still names that connection, which is the row a reader needs most", () => {
    state.connections = [connection({ state: "TORN_DOWN" })];
    state.rows = [token()];

    renderWithScimHost(<ScimScreen />);

    expect(screen.getByText("Okta")).toBeTruthy();
  });
});

const request = (overrides: Record<string, unknown> = {}) => ({
  id: "req-1",
  method: "POST",
  resource: "Users",
  status: 400,
  reason: "invalid_resource",
  detail: "The resource is not valid: externalId",
  occurredAt: "2026-08-26T10:10:52.000Z",
  ...overrides,
});

describe("given the directory has been pushing through a connection", () => {
  /** @scenario "What the provider sent is there for whoever needs it, and folded for everybody else" */
  it("folds what the provider sent away until it is asked for", () => {
    state.requests["org-1/ssoconn_1"] = [request()];
    state.panel = {
      connections: [],
      recentChanges: [
        {
          grantId: "grant_sam_member",
          summary: "Sam Patel lost access",
          author: "Your identity provider",
          occurredAtMs: Date.UTC(2026, 8, 20, 9, 0, 0),
          kind: "removed",
        },
      ],
    };

    renderWithScimHost(<ConnectorsScreen />);

    expect(screen.getByTestId("directory-recent-changes").textContent).toContain(
      "Sam Patel lost access",
    );
    expect(screen.getByTestId("directory-requests-toggle").textContent).toContain(
      "Show what your identity provider sent",
    );
    expect(screen.queryByTestId("directory-requests")).toBeNull();
    expect(calls.getRequests).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("directory-requests-toggle"));

    expect(within(screen.getByTestId("directory-requests")).getByText(/POST users/)).toBeTruthy();
    expect(calls.getRequests).toHaveBeenCalled();
  });

  /** @scenario "The requests a connection has served are on the SCIM settings page" */
  it("reads them newest first, refusals in our own words", () => {
    state.requests["org-1/ssoconn_1"] = [
      request(),
      request({
        id: "req-0",
        method: "GET",
        resource: "Users",
        status: 200,
        reason: null,
        detail: null,
        occurredAt: "2026-08-26T10:09:00.000Z",
      }),
    ];

    renderWithScimHost(<ScimScreen />);
    fireEvent.click(screen.getByTestId("directory-requests-toggle"));

    const feed = screen.getByTestId("directory-requests");
    expect(within(feed).getByText(/POST users/)).toBeTruthy();
    expect(within(feed).getByText("Refused")).toBeTruthy();
    expect(within(feed).getByText(/The resource is not valid: externalId/)).toBeTruthy();
    // The slug is what a reader branches on, never what they read.
    expect(within(feed).queryByText("invalid_resource")).toBeNull();
    // The server answers newest first and the page keeps that order.
    const badges = within(feed)
      .getAllByText(/Refused|Accepted/)
      .map((node) => node.textContent);
    expect(badges).toEqual(["Refused", "Accepted"]);
  });

  it("says what it still holds rather than that nothing was ever sent", () => {
    renderWithScimHost(<ScimScreen />);
    fireEvent.click(screen.getByTestId("directory-requests-toggle"));

    const feed = screen.getByTestId("directory-requests");
    expect(within(feed).getByText(/thirty days/i)).toBeTruthy();
    expect(within(feed).queryByText(/never sent|nothing was sent/i)).toBeNull();
  });
});

describe("given another organization's directory has been pushing too", () => {
  /** @scenario "Another organization's requests are not there to read" */
  it("asks for the tenant as well as the connection, so only ours come back", () => {
    state.requests["org-globex/ssoconn_1"] = [
      request({ id: "req-globex", detail: "Globex asked for something" }),
    ];

    renderWithScimHost(<ScimScreen />);
    fireEvent.click(screen.getByTestId("directory-requests-toggle"));

    expect(calls.getRequests).toHaveBeenCalledWith({
      organizationId: "org-1",
      connectionId: "ssoconn_1",
    });
    expect(screen.queryByText(/Globex asked for something/)).toBeNull();
  });
});

describe("given a token nothing has ever presented", () => {
  /** @scenario "A token nothing has presented says so, rather than only showing a date that is missing" */
  it("says so in words pointing at the provider, not only a missing date", () => {
    state.rows = [token()];

    renderWithScimHost(<ScimScreen />);

    expect(screen.getByText(/Nothing has presented this token yet/)).toBeTruthy();
    expect(screen.getByText(/check the token it is using/)).toBeTruthy();
  });
});

describe("given no identity provider is connected", () => {
  it("offers the first step to a reader who manages single sign-on", () => {
    renderWithScimHost(<ScimScreen />);

    expect(screen.getByText("No identity provider is connected yet")).toBeTruthy();
    const door = screen.getByRole("link", { name: "Set up single sign-on" });
    expect(door.getAttribute("href")).toBe("/settings/authentication");
  });

  /** @scenario "The first step is not offered to somebody who would be refused it" */
  it("offers no control to a reader who cannot manage it", () => {
    renderWithScimHost(<ScimScreen />, new FakeScimHost({ withheld: ["sso:manage"] }));

    expect(screen.queryByRole("link", { name: "Set up single sign-on" })).toBeNull();
    expect(screen.queryByTestId("scim-generate-open")).toBeNull();
    expect(screen.getByText(/an administrator who manages single sign-on/i)).toBeTruthy();
  });
});

describe("given a reader who may see single sign-on but not manage it", () => {
  const withheld = new FakeScimHost({ withheld: ["sso:manage"] });

  beforeEach(() => {
    state.rows = [token()];
    state.panel = {
      connections: [
        {
          connectionId: "ssoconn_1",
          providerId: "Okta",
          verifiedDomains: [],
          connectionState: "ACTIVE",
          state: "SYNCING",
          status: { headline: "Syncing", waitingFor: "", tone: "working" },
          lastPushedAtMs: Date.UTC(2026, 8, 16, 17, 57, 0),
          managedPeople: 498,
          failures: [],
          remediation: "",
        },
      ],
      recentChanges: [],
    };
    state.activity = [
      {
        eventId: "evt_1",
        summary: "Your directory added a person",
        occurredAtMs: Date.UTC(2026, 8, 16, 17, 57, 0),
        outcome: "ok",
      },
    ];
  });

  /** @scenario "Seeing the sequence takes the same permission as seeing the state" */
  it("reads what the directory has been doing, is offered nothing that writes, and sees no error", async () => {
    renderWithScimHost(<ScimScreen />, withheld);

    fireEvent.click(screen.getByRole("button", { name: "Recent directory activity" }));

    expect(await screen.findByText("Your directory added a person")).toBeTruthy();
    expect(screen.queryByTestId("scim-generate-open")).toBeNull();
    expect(screen.queryByTestId("scim-token-revoke")).toBeNull();
    expect(screen.queryByText("Access Restricted")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  /** @scenario "Seeing sync status and managing tokens are two different permissions" */
  it("reads the reconciliation panel normally and offers no minting or revoking", () => {
    renderWithScimHost(<ScimScreen />, withheld);

    expect(screen.getAllByTestId("directory-connection")).toHaveLength(1);
    expect(screen.getByTestId("directory-connection").textContent).toContain("Okta");
    expect(screen.queryByTestId("scim-generate-open")).toBeNull();
    expect(screen.queryByTestId("scim-token-revoke")).toBeNull();
  });
});

describe("given a reader without sso:view", () => {
  it("says which permission the page needs and shows none of it", () => {
    renderWithScimHost(<ScimScreen />, new FakeScimHost({ withheld: ["sso:view"] }));

    expect(screen.getByText(/required permission: sso:view/i)).toBeTruthy();
    expect(screen.queryByText("Provisioning tokens")).toBeNull();
  });
});

describe("given the directory has provisioned people", () => {
  const member = (id: string, name: string) => ({
    id,
    name,
    email: `${id}@example.com`,
    deactivatedAt: null,
  });

  /** @scenario The people who arrived another way are not in that list */
  it("names only the ones it manages", () => {
    state.members = [member("u1", "Sam Directory"), member("u2", "Ana Invited")];
    state.provenance = { u1: { source: "directory" }, u2: { source: "invited" } };

    renderWithScimHost(<ScimScreen />);

    const list = screen.getByTestId("directory-managed-members");
    expect(within(list).getByText("Sam Directory")).toBeTruthy();
    expect(within(list).queryByText("Ana Invited")).toBeNull();
  });

  /** @scenario The list shows enough to see the sync is real, then hands over */
  it("shows the first eight and hands over to the page that lists everybody", () => {
    const people = Array.from({ length: 9 }, (_, index) => member(`u${index}`, `Person ${index}`));
    state.members = people;
    state.provenance = Object.fromEntries(people.map(({ id }) => [id, { source: "directory" }]));

    renderWithScimHost(<ScimScreen />);

    expect(screen.getAllByTestId("directory-managed-member")).toHaveLength(8);
    expect(screen.getByTestId("directory-managed-more")).toHaveTextContent("Showing 8 of 9");
    expect(screen.getByRole("link", { name: "See everyone in your directory" })).toBeTruthy();
  });

  /** @scenario Somebody managed whose access is switched off is still listed */
  it("keeps a deactivated person as a row, marked, and marks an ordinary one nothing", () => {
    state.members = [
      { ...member("u1", "Sam Directory"), deactivatedAt: "2026-01-02T00:00:00.000Z" },
      member("u2", "Ana Directory"),
    ];
    state.provenance = { u1: { source: "directory" }, u2: { source: "directory" } };

    renderWithScimHost(<ScimScreen />);

    const rows = screen.getAllByTestId("directory-managed-member");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByTestId("member-deactivated")).toBeTruthy();
    expect(within(rows[1]!).queryByTestId("member-deactivated")).toBeNull();
  });

  /** @scenario A directory that has provisioned nobody says so honestly */
  it("says nobody was provisioned and that the members arrived another way", () => {
    state.members = [member("u1", "Sam Invited"), member("u2", "Ana Invited")];
    state.provenance = { u1: { source: "invited" }, u2: { source: "invited" } };

    renderWithScimHost(<ScimScreen />);

    expect(screen.getByTestId("directory-managed-empty")).toHaveTextContent(
      "has not provisioned anyone yet",
    );
    expect(screen.getByTestId("directory-managed-empty")).toHaveTextContent("arrived another way");
  });

  /** @scenario A roster that could not be read is not drawn as an empty one */
  it("says what could not be read and lists nobody as managed", () => {
    state.members = [member("u1", "Sam Directory")];
    state.provenance = { u1: { source: "directory" } };
    state.membersError = new Error("the roster read failed");

    renderWithScimHost(<ScimScreen />);

    expect(screen.getByText(/Couldn't read the people your directory manages/)).toBeTruthy();
    expect(screen.queryByTestId("directory-managed-members")).toBeNull();
    expect(screen.queryByTestId("directory-managed-empty")).toBeNull();
  });

  /** @scenario A reader who may not read membership is not shown a roster */
  it("is absent for a reader who may not read the roster", () => {
    renderWithScimHost(<ScimScreen />, new FakeScimHost({ withheld: ["organization:manage"] }));

    expect(screen.queryByText("People your directory manages")).toBeNull();
  });
});

describe("when the administrator brings a token of their own", () => {
  it("sends it as the secret and never displays it back", async () => {
    renderWithScimHost(<ScimScreen />);

    const submit = await openGenerateDialog();
    fireEvent.change(screen.getByLabelText("Token"), { target: { value: " from-the-idp " } });
    fireEvent.click(screen.getAllByRole("button", { name: /save token/i }).at(-1) ?? submit);

    expect(calls.generate).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: "ssoconn_1", secret: "from-the-idp" }),
    );
    expect(screen.queryByDisplayValue("scim_live_secret_value")).toBeNull();
  });
});
