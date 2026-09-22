/**
 * @vitest-environment jsdom
 *
 * Tests SCIM settings: IdP endpoint address and authentication token.
 * Critical: token shown exactly once; generate shows plaintext, list never shows secrets.
 */

import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
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
    /** Recorded requests, keyed by the tenant AND connection they were asked
     *  for: a feed answered for any other key is a feed nobody may read. */
    requests: {} as Record<string, Record<string, unknown>[]>,
  },
  calls: { generate: vi.fn(), revoke: vi.fn(), invalidate: vi.fn(), getRequests: vi.fn() },
}));

vi.mock("../../../behavior/scim-api.ts", () => ({
  scimApi: {
    useUtils: () => ({ scimToken: { list: { invalidate: calls.invalidate } } }),
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
  fireEvent.click(screen.getByRole("button", { name: /generate token/i }));

  return waitFor(() => {
    const buttons = screen.getAllByRole("button", { name: /generate token/i });
    if (buttons.length < 2) throw new Error("the dialog has not mounted yet");
    return buttons[buttons.length - 1]!;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.rows = [];
  state.connections = [connection()];
  state.minted = { token: "scim_live_secret_value" };
  state.requests = {};
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

    expect(screen.getByText(/no scim tokens yet/i)).toBeTruthy();
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
