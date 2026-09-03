/**
 * @vitest-environment jsdom
 *
 * `/cli/auth`: the code check, what the approval carries, and who it is offered.
 *
 * Consolidates three platform suites — `cliAuthKeySelection`,
 * `cliAuthProjectPicker` and `cliAuthFirstTraceRedirect` — onto this package's
 * host harness. THE ONE STRUCTURAL CHANGE is where the wire lives: the platform
 * files replaced `globalThis.fetch` and asserted on the request bodies it saw.
 * A screen may not call `fetch`, so the three calls are host methods, and the
 * fake host records the SELECTION each one carried. What the adapter turns that
 * selection into — the paths, the method, the snake-cased body — is pinned in
 * `apps/ui/tests/cli-auth-exchange.integration.test.tsx`, which is where the
 * wire actually lives. Between them the coverage is the same and each half is
 * asserted where it is decided.
 *
 * Specs: specs/ai-governance/cli-onboarding/login-user-scoped-key.feature,
 *        specs/ai-governance/cli-onboarding/authorize-project-picker.feature,
 *        specs/ai-governance/cli-onboarding/post-login-first-trace-redirect.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { defaultCliKeyPermissions } from "@langwatch/api-key-contract";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiKeyHostProvider } from "../../../model/api-key-host";
import { FakeApiKeyHost, renderWithApiKeyHost } from "../../../testing";
import CliAuthScreen from "../cli-auth.screen";

const { state } = vi.hoisted(() => ({
  state: {
    bindings: [] as Array<{ scopeType: string; scopeId: string; role: string }>,
    bindingsLoading: false,
    firstMessage: void 0 as boolean | undefined,
  },
}));

vi.mock("../../../behavior/api-key-api", () => ({
  apiKeyApi: {
    useUtils: () => ({ apiKey: { list: { invalidate: vi.fn() } } }),
    apiKey: {
      myBindings: {
        useQuery: () => ({ data: state.bindings, isLoading: state.bindingsLoading }),
      },
    },
    project: {
      getHasFirstMessage: {
        useQuery: () => ({ data: { firstMessage: state.firstMessage ?? true } }),
      },
    },
    organization: { getAll: { useQuery: () => ({ data: [] }) } },
  },
}));

// The picker is `@langwatch/authz-web`'s and has its own suite; what this file
// is about is which scopes the SCREEN preselects and sends, so the picker
// renders its value and offers one way to change it.
vi.mock("@langwatch/authz-web/surfaces/scope-picker", () => ({
  ScopeChipPicker: ({
    value,
    onChange,
  }: {
    value: Array<{ scopeType: string; scopeId: string }>;
    onChange: (next: Array<{ scopeType: string; scopeId: string }>) => void;
  }) => (
    <div>
      <span data-testid="selected-scopes">
        {value.map((entry) => `${entry.scopeType}:${entry.scopeId}`).join(",")}
      </span>
      <button data-testid="clear-scopes" onClick={() => onChange([])} />
      <button
        data-testid="pick-personal"
        onClick={() => onChange([{ scopeType: "PROJECT", scopeId: "proj-personal" }])}
      />
    </div>
  ),
}));

const ORG_WITH_TEAMS = [
  {
    id: "org-1",
    name: "ACME",
    teams: [
      {
        id: "team-1",
        name: "Platform",
        isPersonal: false,
        projects: [{ id: "proj-1", name: "Web App", slug: "web-app" }],
      },
      {
        id: "team-2",
        name: "Growth",
        isPersonal: false,
        projects: [{ id: "proj-2", name: "Growth App", slug: "growth-app" }],
      },
      {
        id: "team-personal",
        name: "Jane's Workspace",
        isPersonal: true,
        ownerUserId: "user-1",
        projects: [
          {
            id: "proj-personal",
            name: "Personal Workspace",
            slug: "jane-personal",
            isPersonal: true,
            ownerUserId: "user-1",
          },
        ],
      },
    ],
  },
];

function hostFor(options: Partial<ConstructorParameters<typeof FakeApiKeyHost>[0]> = {}) {
  return new FakeApiKeyHost({
    query: { user_code: "WDJB-MJHT" },
    organizations: ORG_WITH_TEAMS,
    ...options,
  });
}

async function confirmCode(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Confirm" }));
}

beforeEach(() => {
  state.bindings = [];
  state.bindingsLoading = false;
  state.firstMessage = void 0;
});

afterEach(() => cleanup());

describe("given a pending device code", () => {
  describe("when the page opens", () => {
    /** @scenario the screen asks for the code check first */
    it("shows only the code and the confirm action before anything else", async () => {
      renderWithApiKeyHost(<CliAuthScreen />, hostFor());
      expect(await screen.findByText("WDJB-MJHT")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
      expect(screen.queryByText("What the CLI can access")).toBeNull();
    });

    /** @scenario the CLI stamps itself as the acquisition source */
    it("records the lead source once, first-touch", async () => {
      const host = hostFor();
      renderWithApiKeyHost(<CliAuthScreen />, host);
      await screen.findByText("WDJB-MJHT");
      expect(host.leadSources).toEqual(["cli"]);
    });
  });

  describe("when the user confirms the code", () => {
    /** @scenario confirming the code reveals the access selection */
    it("hides the code section and shows the access selection", async () => {
      const user = userEvent.setup();
      state.bindings = [{ scopeType: "ORGANIZATION", scopeId: "org-1", role: "ADMIN" }];
      renderWithApiKeyHost(<CliAuthScreen />, hostFor());
      await confirmCode(user);
      expect(await screen.findByText("What the CLI can access")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
    });
  });
});

describe("given an organization admin", () => {
  beforeEach(() => {
    state.bindings = [{ scopeType: "ORGANIZATION", scopeId: "org-1", role: "ADMIN" }];
  });

  describe("when the approval goes out", () => {
    /** @scenario org admin defaults to organization scope */
    it("carries an organization binding rather than a list of teams", async () => {
      const user = userEvent.setup();
      const host = hostFor();
      renderWithApiKeyHost(<CliAuthScreen />, host);
      await confirmCode(user);
      await waitFor(() =>
        expect(screen.getByTestId("selected-scopes")).toHaveTextContent("ORGANIZATION:org-1"),
      );
      await user.click(screen.getByRole("button", { name: "Approve" }));
      await waitFor(() => expect(host.approvals).toHaveLength(1));
      expect(host.approvals[0]!.keySelection?.bindings).toEqual([
        { scopeType: "ORGANIZATION", scopeId: "org-1" },
      ]);
      expect(host.approvals[0]!.userCode).toBe("WDJB-MJHT");
      expect(host.approvals[0]!.organizationId).toBe("org-1");
      expect(host.approvals[0]!.projectId).toBeUndefined();
    });

    /** @scenario the organization-management permissions are off by default */
    it("sends a default list with nothing that manages the organization", async () => {
      const user = userEvent.setup();
      const host = hostFor();
      renderWithApiKeyHost(<CliAuthScreen />, host);
      await confirmCode(user);
      await user.click(await screen.findByRole("button", { name: "Approve" }));
      await waitFor(() => expect(host.approvals).toHaveLength(1));
      const permissions = host.approvals[0]!.keySelection!.permissions;
      expect(permissions.length).toBeGreaterThan(0);
      // The three the default list excludes outright — administering the
      // organization is not everyday work, and an org admin's CLI key is the
      // one place that difference is worth keeping.
      for (const excluded of ["organization:manage", "organization:delete", "team:manage"]) {
        expect(permissions).not.toContain(excluded);
      }
      // Every permission sent is one the default list offers: the key can never
      // be given something the reader did not review.
      const offered = new Set<string>(defaultCliKeyPermissions());
      for (const permission of permissions) expect(offered.has(permission)).toBe(true);
    });

    /** @scenario approval with zero scopes selected is refused */
    it("disables approve when every scope is deselected, and sends nothing", async () => {
      const user = userEvent.setup();
      const host = hostFor();
      renderWithApiKeyHost(<CliAuthScreen />, host);
      await confirmCode(user);
      await user.click(await screen.findByTestId("clear-scopes"));
      await waitFor(() => expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled());
      expect(host.approvals).toEqual([]);
    });
  });

  describe("when the bindings have not arrived yet", () => {
    /** @scenario approval with zero scopes selected is refused */
    it("keeps approve unavailable, so no approval can carry an empty ceiling", async () => {
      const user = userEvent.setup();
      state.bindingsLoading = true;
      renderWithApiKeyHost(<CliAuthScreen />, hostFor());
      await confirmCode(user);
      expect(await screen.findByText("Loading your access…")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    });
  });
});

describe("given a member of two shared teams", () => {
  /** @scenario regular member defaults to their own teams plus personal workspace */
  it("preselects the teams they hold and their own workspace, never the organization", async () => {
    const user = userEvent.setup();
    state.bindings = [
      { scopeType: "TEAM", scopeId: "team-1", role: "MEMBER" },
      { scopeType: "TEAM", scopeId: "team-2", role: "MEMBER" },
      { scopeType: "TEAM", scopeId: "team-personal", role: "ADMIN" },
    ];
    renderWithApiKeyHost(<CliAuthScreen />, hostFor());
    await confirmCode(user);
    await waitFor(() =>
      expect(screen.getByTestId("selected-scopes")).toHaveTextContent(
        "TEAM:team-1,TEAM:team-2,PROJECT:proj-personal",
      ),
    );
  });

  /** @scenario approval with zero scopes selected is refused */
  it("says there is nothing to give when the reader holds no access and has no workspace", async () => {
    const user = userEvent.setup();
    state.bindings = [];
    // No personal workspace either: the defaults always add one when it exists,
    // so "nothing to offer" is only reachable without it. That is the
    // separation the message is for — "you deselected everything" reads
    // differently from "there is nothing here for you".
    renderWithApiKeyHost(
      <CliAuthScreen />,
      hostFor({
        organizations: [
          {
            id: "org-1",
            name: "ACME",
            teams: [
              {
                id: "team-1",
                name: "Platform",
                isPersonal: false,
                projects: [{ id: "proj-1", name: "Web App", slug: "web-app" }],
              },
            ],
          },
        ],
      }),
    );
    await confirmCode(user);
    expect(
      await screen.findByText(/Your account holds no access in this organization/),
    ).toBeInTheDocument();
  });
});

describe("given teams the reader holds different roles on", () => {
  /** @scenario the offered permissions are the intersection of every selected scope */
  it("sends only the permissions every selected scope grants", async () => {
    const user = userEvent.setup();
    // ADMIN on one shared team, VIEWER on the other, and ADMIN on their own
    // workspace — which the defaults always add as a scope, so it has to hold a
    // binding or the intersection would be empty for a reason unrelated to the
    // two teams.
    state.bindings = [
      { scopeType: "TEAM", scopeId: "team-1", role: "ADMIN" },
      { scopeType: "TEAM", scopeId: "team-2", role: "VIEWER" },
      { scopeType: "TEAM", scopeId: "team-personal", role: "ADMIN" },
    ];
    const host = hostFor();
    renderWithApiKeyHost(<CliAuthScreen />, host);
    await confirmCode(user);
    await waitFor(() => expect(screen.getByRole("button", { name: "Approve" })).not.toBeDisabled());
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(host.approvals).toHaveLength(1));
    const held = new Set(host.approvals[0]!.keySelection!.permissions);
    // A VIEWER holds the read side everywhere, so it survives the intersection.
    expect(held.has("traces:view")).toBe(true);
    // The write side is ADMIN-only on one team and absent on the other, so no
    // permission the VIEWER team refuses may go out — sending one would fail
    // the whole approval with `api_key_scope_violation` rather than dropping it.
    for (const adminOnly of ["traces:update", "datasets:manage", "project:manage"]) {
      expect(held.has(adminOnly)).toBe(false);
    }
  });
});

describe("given the CLI asked for a project API key", () => {
  const projectLookup = {
    outcome: "pending" as const,
    userCode: "WDJB-MJHT",
    status: "pending",
    expiresAt: Date.now() + 600_000,
    credentialType: "project_api_key" as const,
  };

  describe("when the organization has shared projects", () => {
    /** @scenario a user with shared projects sees personal as an explicit entry, not an implication */
    /** @scenario approving with the personal project selected returns the personal project key */
    it("sends the project the reader picked and no key selection at all", async () => {
      const user = userEvent.setup();
      const host = hostFor({ lookup: projectLookup });
      renderWithApiKeyHost(<CliAuthScreen />, host);
      await confirmCode(user);
      await user.click(await screen.findByTestId("pick-personal"));
      await user.click(screen.getByRole("button", { name: "Send API key" }));
      await waitFor(() => expect(host.approvals).toHaveLength(1));
      expect(host.approvals[0]!.projectId).toBe("proj-personal");
      // A project login hands over a project's key; there is no per-permission
      // selection to review, so none is sent.
      expect(host.approvals[0]!.keySelection).toBeUndefined();
    });

    /** @scenario the no-shared-projects state offers a create-project action */
    it("offers Create project by address, naming the picked organization", async () => {
      const user = userEvent.setup();
      const host = hostFor({ lookup: projectLookup });
      renderWithApiKeyHost(<CliAuthScreen />, host);
      await confirmCode(user);
      await user.click(await screen.findByRole("button", { name: /Create project/ }));
      expect(host.drawerOpens).toEqual([
        { drawer: "createProject", params: { organizationId: "org-1" } },
      ]);
    });
  });
});

describe("given a second login is opened in the same tab", () => {
  /** @scenario a new device code starts the confirmation over */
  it("returns to the confirmation step with no trace of the old flow", async () => {
    const user = userEvent.setup();
    state.bindings = [{ scopeType: "ORGANIZATION", scopeId: "org-1", role: "ADMIN" }];
    const first = hostFor();
    const { rerender } = renderWithApiKeyHost(<CliAuthScreen />, first);
    await confirmCode(user);
    expect(await screen.findByText("What the CLI can access")).toBeInTheDocument();

    // The same screen, a different code: every gate binds to the code in the
    // address rather than to the lookup alone, because the reset effect runs
    // after paint and the first render would otherwise still show step two.
    const second = hostFor({
      query: { user_code: "PQRS-TUVW" },
      lookup: {
        outcome: "pending",
        userCode: "PQRS-TUVW",
        status: "pending",
        expiresAt: Date.now() + 600_000,
        credentialType: "device_session",
      },
    });
    rerender(
      <ChakraProvider value={defaultSystem}>
        <ApiKeyHostProvider value={second}>
          <CliAuthScreen />
        </ApiKeyHostProvider>
      </ChakraProvider>,
    );

    expect(await screen.findByText("PQRS-TUVW")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
    expect(screen.queryByText("What the CLI can access")).toBeNull();
  });
});

describe("given the reader narrows what the key may do", () => {
  /** @scenario narrowing the selection narrows the minted key */
  /** @scenario Customized permissions follow the scopes that are selected */
  it("sends exactly what the customized rows compute, not the default list", async () => {
    const user = userEvent.setup();
    state.bindings = [{ scopeType: "ORGANIZATION", scopeId: "org-1", role: "ADMIN" }];
    const host = hostFor();
    renderWithApiKeyHost(<CliAuthScreen />, host);
    await confirmCode(user);

    await user.click(await screen.findByRole("button", { name: "Customize" }));
    // Narrowing one category to Read is enough: what is asserted is that the
    // approval carries the CUSTOMIZED computation rather than the default list,
    // which the counter above the rows reports.
    const tracesRow = screen.getByText("Traces").parentElement as HTMLElement;
    await user.click(within(tracesRow).getByText("Write"));
    await user.click(await screen.findByRole("menuitem", { name: "Read" }));

    await user.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(host.approvals).toHaveLength(1));
    const held = new Set(host.approvals[0]!.keySelection!.permissions);
    expect(held.has("traces:view")).toBe(true);
    expect(held.has("traces:update")).toBe(false);
  });
});

describe("given the reader denies the request", () => {
  /** @scenario denying the code rejects the CLI session */
  it("tells the CLI, and says so even if the call could not be made", async () => {
    const user = userEvent.setup();
    const host = hostFor();
    renderWithApiKeyHost(<CliAuthScreen />, host);
    await user.click(await screen.findByRole("button", { name: "Deny" }));
    await waitFor(() => expect(host.denials).toEqual(["WDJB-MJHT"]));
    expect(await screen.findByText("Authorization denied")).toBeInTheDocument();
  });
});

describe("given a code nothing recognises", () => {
  /** @scenario an unrecognised code explains itself */
  it("names the code and says it may have expired or been used", async () => {
    renderWithApiKeyHost(<CliAuthScreen />, hostFor({ lookup: { outcome: "unknown" } }));
    expect(await screen.findByText(/Code "WDJB-MJHT" was not recognised/)).toBeInTheDocument();
  });
});

describe("given a code past its deadline", () => {
  /** @scenario an expired code sends the reader back to their terminal */
  it("says to run langwatch login again rather than showing a generic failure", async () => {
    renderWithApiKeyHost(<CliAuthScreen />, hostFor({ lookup: { outcome: "expired" } }));
    expect(await screen.findByText("Code expired")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).toBeNull();
  });
});

describe("given the approval is refused", () => {
  /** @scenario a refused approval says why */
  it("shows the message the endpoint sent rather than a generic line", async () => {
    const user = userEvent.setup();
    state.bindings = [{ scopeType: "ORGANIZATION", scopeId: "org-1", role: "ADMIN" }];
    renderWithApiKeyHost(
      <CliAuthScreen />,
      hostFor({ approve: { outcome: "failed", message: "Not a member of organization org-1" } }),
    );
    await confirmCode(user);
    await user.click(await screen.findByRole("button", { name: "Approve" }));
    expect(await screen.findByText("Approval failed")).toBeInTheDocument();
    expect(screen.getByText("Not a member of organization org-1")).toBeInTheDocument();
  });
});

describe("given no session yet", () => {
  /** @scenario an unauthenticated reader is bounced through sign-in with their code */
  it("sends them to sign-in with the device code preserved in the callback", async () => {
    const host = hostFor({ sessionStatus: "unauthenticated", currentUser: null });
    renderWithApiKeyHost(<CliAuthScreen />, host);
    await waitFor(() => expect(host.navigations).toHaveLength(1));
    expect(host.navigations[0]).toEqual({
      kind: "replace",
      to: "/auth/signin?callbackUrl=%2Fcli%2Fauth%3Fuser_code%3DWDJB-MJHT",
    });
    // And nothing is looked up for a reader who is not signed in.
    expect(host.lookups).toEqual([]);
  });

  /** @scenario a reader whose session is still arriving is not bounced */
  it("waits rather than redirecting while the session answer is in flight", async () => {
    const host = hostFor({ sessionStatus: "loading", currentUser: null });
    renderWithApiKeyHost(<CliAuthScreen />, host);
    await waitFor(() => expect(host.lookups).toEqual([]));
    expect(host.navigations).toEqual([]);
  });
});

describe("given a brand-new reader with no organization", () => {
  /** @scenario a reader who signed up mid-login round-trips through onboarding */
  it("sends them to onboarding and back, keeping the device code", async () => {
    const host = hostFor({ organizations: [] });
    renderWithApiKeyHost(<CliAuthScreen />, host);
    await waitFor(() => expect(host.navigations).toHaveLength(1));
    expect(host.navigations[0]).toEqual({
      kind: "replace",
      to: "/onboarding/welcome?return_to=%2Fcli%2Fauth%3Fuser_code%3DWDJB-MJHT",
    });
  });
});
