/**
 * @vitest-environment jsdom
 *
 * Covers the authorize-screen scenarios of
 * specs/ai-governance/cli-onboarding/login-user-scoped-key.feature.
 *
 * The real /cli/auth page runs in device_session mode. The screen now shows
 * what the minted CLI key will be able to access: a scope selection
 * preselected to the widest access the user holds (organization for org
 * admins, shared teams plus personal workspace for members) and a permission
 * default that keeps organization management off. Only the network boundary
 * is replaced: `fetch` answers like the CLI auth REST endpoints and the tRPC
 * hooks resolve fixtures. Under test is what the approve request carries in
 * `key_selection` and when the approve action is available.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultCliKeyPermissions } from "@langwatch/api-key-contract";

const { fetchMock, sessionRef, orgsRef, bindingsRef } = vi.hoisted(() => {
  const fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return {
    fetchMock,
    sessionRef: {
      current: {
        data: { user: { id: "user-1", email: "dev@example.com" } },
        status: "authenticated" as const,
      },
    },
    orgsRef: { current: [] as unknown[] },
    bindingsRef: {
      current: [] as Array<{
        scopeType: string;
        scopeId: string;
        role: string;
      }>,
    },
  };
});

vi.mock("~/utils/auth-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/utils/auth-client")>();
  return { ...actual, useSession: () => sessionRef.current };
});

vi.mock("~/utils/api", () => ({
  api: {
    publicEnv: {
      useQuery: () => ({ data: {}, isLoading: false }),
    },
    sharedTrace: {
      get: { useQuery: () => ({ data: undefined, isLoading: false }) },
    },
    organization: {
      getAll: {
        useQuery: () => ({
          data: orgsRef.current,
          isLoading: false,
          isFetched: true,
        }),
      },
    },
    modelProvider: {
      getAllForProject: {
        useQuery: () => ({ data: undefined, isLoading: false }),
      },
    },
    apiKey: {
      myBindings: {
        useQuery: () => ({ data: bindingsRef.current, isLoading: false }),
      },
    },
    project: {
      getHasFirstMessage: {
        useQuery: () => ({ data: undefined, isLoading: false }),
      },
    },
  },
}));

import { useRouter } from "~/utils/compat/next-router";
import CliAuthPage from "../auth";

const mockRouter = useRouter();

const personalTeam = {
  id: "team-personal",
  slug: "personal-team",
  name: "Jane's Workspace",
  isPersonal: true,
  ownerUserId: "user-1",
  projects: [
    {
      id: "proj-personal",
      slug: "personal-proj",
      name: "Personal Workspace",
      isPersonal: true,
      ownerUserId: "user-1",
      kind: "application",
    },
  ],
};

const sharedTeam = ({
  id,
  name,
  projects,
}: {
  id: string;
  name: string;
  projects: Array<Record<string, unknown>>;
}) => ({
  id,
  slug: id,
  name,
  isPersonal: false,
  ownerUserId: null,
  projects,
});

const sharedProject = ({ id, name }: { id: string; name: string }) => ({
  id,
  slug: id,
  name,
  isPersonal: false,
  kind: "application",
});

const acmeOrg = {
  id: "org-1",
  name: "Acme Org",
  teams: [
    personalTeam,
    sharedTeam({
      id: "team-eng",
      name: "Engineering",
      projects: [sharedProject({ id: "proj-a", name: "Alpha" })],
    }),
    sharedTeam({
      id: "team-res",
      name: "Research",
      projects: [sharedProject({ id: "proj-b", name: "Beta" })],
    }),
  ],
};

const approveBodies: Array<{
  organization_id?: string;
  key_selection?: {
    bindings: Array<{ scope_type: string; scope_id: string }>;
    permissions: string[];
  };
}> = [];

const serveCliAuthEndpoints = () => {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/auth/cli/lookup")) {
      return new Response(
        JSON.stringify({
          user_code: "WDJB-MJHT",
          status: "pending",
          expires_at: Date.now() + 10 * 60_000,
          credential_type: "device_session",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("/api/auth/cli/approve")) {
      approveBodies.push(
        JSON.parse(String(init?.body ?? "{}")) as (typeof approveBodies)[0],
      );
      return new Response(JSON.stringify({ ok: true, kind: "device_session" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
};

const pageElement = () => (
  <ChakraProvider value={defaultSystem}>
    <CliAuthPage />
  </ChakraProvider>
);

const renderPage = () => render(pageElement());

const approveButton = () =>
  screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement;

/**
 * Step one of the screen: the code check. The organization picker, the
 * access selection and the approve action do not exist until it passes, so
 * every flow below confirms the terminal code right after rendering.
 */
const confirmCode = async (user: ReturnType<typeof userEvent.setup>) => {
  await waitFor(() =>
    expect(screen.getByText("WDJB-MJHT")).toBeInTheDocument(),
  );
  await user.click(screen.getByRole("button", { name: "Confirm" }));
  await waitFor(() =>
    expect(
      screen.queryByText(/Confirm this matches the code shown in your/),
    ).toBeNull(),
  );
};

beforeEach(() => {
  fetchMock.mockReset();
  (mockRouter.push as unknown as Mock).mockClear();
  (mockRouter.replace as unknown as Mock).mockClear();
  mockRouter.query = { user_code: "WDJB-MJHT" };
  approveBodies.length = 0;
  orgsRef.current = [acmeOrg];
  window.localStorage.clear();
  serveCliAuthEndpoints();
});

afterEach(() => {
  cleanup();
  mockRouter.query = {};
});

describe("/cli/auth key selection, given an organization admin", () => {
  beforeEach(() => {
    bindingsRef.current = [
      { scopeType: "ORGANIZATION", scopeId: "org-1", role: "ADMIN" },
    ];
  });

  /** @scenario "org admin defaults to organization scope" */
  it("preselects the whole organization and approves with an organization binding", async () => {
    const user = userEvent.setup();
    renderPage();
    await confirmCode(user);

    await waitFor(() =>
      expect(screen.getAllByText("Acme Org").length).toBeGreaterThan(0),
    );
    await waitFor(() => expect(approveButton().disabled).toBe(false));
    await user.click(approveButton());

    await waitFor(() => expect(approveBodies.length).toBe(1));
    expect(approveBodies[0]?.organization_id).toBe("org-1");
    expect(approveBodies[0]?.key_selection?.bindings).toEqual([
      { scope_type: "ORGANIZATION", scope_id: "org-1" },
    ]);
    expect(approveBodies[0]?.key_selection?.permissions).toEqual(
      defaultCliKeyPermissions(),
    );
  });

  /** @scenario "the organization-management permissions are off by default" */
  it("sends a default permission list without the organization-management set", async () => {
    const user = userEvent.setup();
    renderPage();
    await confirmCode(user);

    await waitFor(() => expect(approveButton().disabled).toBe(false));
    await user.click(approveButton());

    await waitFor(() => expect(approveBodies.length).toBe(1));
    const permissions = approveBodies[0]?.key_selection?.permissions ?? [];
    // The literal set the scenario names, so removing one from the constant
    // fails here instead of passing vacuously.
    for (const excluded of [
      "organization:manage",
      "organization:delete",
      "team:manage",
      "ops:view",
      "ops:manage",
    ]) {
      expect(permissions).not.toContain(excluded);
    }
    // Gateway permissions and project settings stay in for everyday work.
    expect(permissions).toContain("gatewayBudgets:view");
    expect(permissions).toContain("project:manage");
    expect(permissions).toContain("traces:view");
  });

  /** @scenario "approval with zero scopes selected is refused" */
  it("disables the approve action when every scope is deselected", async () => {
    const user = userEvent.setup();
    renderPage();
    await confirmCode(user);

    await waitFor(() => expect(approveButton().disabled).toBe(false));

    // Toggle the sole organization scope off in the multi-select.
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: /Acme Org/ }));

    await waitFor(() => expect(approveButton().disabled).toBe(true));
    await user.click(approveButton());
    expect(approveBodies.length).toBe(0);
  });

  /** @scenario "narrowing the selection narrows the minted key" */
  it("sends the customized permission list after narrowing traces to read", async () => {
    const user = userEvent.setup();
    renderPage();
    await confirmCode(user);

    await waitFor(() => expect(approveButton().disabled).toBe(false));
    await user.click(screen.getByRole("button", { name: "Customize" }));

    const tracesRow = screen.getByText("Traces").parentElement as HTMLElement;
    await user.click(within(tracesRow).getByText("Write"));
    await user.click(await screen.findByRole("menuitem", { name: "Read" }));

    await user.click(approveButton());
    await waitFor(() => expect(approveBodies.length).toBe(1));
    const permissions = approveBodies[0]?.key_selection?.permissions ?? [];
    expect(permissions).toContain("traces:view");
    expect(permissions).not.toContain("traces:update");
  });
});

describe("/cli/auth key selection, given a regular member of two shared teams", () => {
  beforeEach(() => {
    bindingsRef.current = [
      { scopeType: "TEAM", scopeId: "team-eng", role: "MEMBER" },
      { scopeType: "TEAM", scopeId: "team-res", role: "MEMBER" },
      { scopeType: "TEAM", scopeId: "team-personal", role: "ADMIN" },
    ];
  });

  /** @scenario "regular member defaults to their own teams plus personal workspace" */
  it("preselects the shared teams plus the personal workspace, not the organization", async () => {
    const user = userEvent.setup();
    renderPage();
    await confirmCode(user);

    await waitFor(() =>
      expect(screen.getAllByText("Engineering").length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText("Research").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Personal Workspace").length).toBeGreaterThan(0);

    await waitFor(() => expect(approveButton().disabled).toBe(false));
    await user.click(approveButton());

    await waitFor(() => expect(approveBodies.length).toBe(1));
    expect(approveBodies[0]?.key_selection?.bindings).toEqual([
      { scope_type: "TEAM", scope_id: "team-eng" },
      { scope_type: "TEAM", scope_id: "team-res" },
      { scope_type: "PROJECT", scope_id: "proj-personal" },
    ]);
    expect(
      approveBodies[0]?.key_selection?.bindings.some(
        (b) => b.scope_type === "ORGANIZATION",
      ),
    ).toBe(false);
  });
});

describe("/cli/auth key selection, given teams the user holds different roles on", () => {
  beforeEach(() => {
    // ADMIN on one shared team, VIEWER on the other. One permission list
    // serves every binding on the minted key, so the ceiling the screen shows
    // has to be the intersection — offering an ADMIN-only permission would
    // make approve fail with api_key_scope_violation at the VIEWER team.
    bindingsRef.current = [
      { scopeType: "TEAM", scopeId: "team-eng", role: "ADMIN" },
      { scopeType: "TEAM", scopeId: "team-res", role: "VIEWER" },
      // Their own workspace, which the defaults always add as a scope.
      { scopeType: "TEAM", scopeId: "team-personal", role: "ADMIN" },
    ];
  });

  /** @scenario "the offered permissions are the intersection of every selected scope" */
  it("sends only the permissions every selected team grants", async () => {
    const user = userEvent.setup();
    renderPage();
    await confirmCode(user);

    await waitFor(() => expect(approveButton().disabled).toBe(false));
    await user.click(approveButton());

    await waitFor(() => expect(approveBodies.length).toBe(1));
    const permissions = approveBodies[0]?.key_selection?.permissions ?? [];
    const held = new Set(permissions);

    // A VIEWER holds the read side everywhere, so it survives the
    // intersection.
    expect(held.has("traces:view")).toBe(true);
    // The write side is ADMIN-only on one team and absent on the other, so
    // no permission the VIEWER team refuses may go out.
    for (const adminOnly of ["traces:update", "datasets:manage", "project:manage"]) {
      expect(held.has(adminOnly)).toBe(false);
    }
  });

  /** @scenario "the offered permissions are the intersection of every selected scope" */
  it("locks the write level on rows only one team grants", async () => {
    const user = userEvent.setup();
    renderPage();
    await confirmCode(user);

    await waitFor(() => expect(approveButton().disabled).toBe(false));
    await user.click(screen.getByRole("button", { name: "Customize" }));

    const tracesRow = screen.getByText("Traces").parentElement as HTMLElement;
    await user.click(within(tracesRow).getByText("Read"));

    // Only Read and None are offered: Write is above the intersected ceiling.
    expect(await screen.findByRole("menuitem", { name: "Read" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Write" })).toBeNull();
  });
});

describe("/cli/auth code confirmation", () => {
  describe("given a pending device code", () => {
    describe("when the page opens", () => {
      /** @scenario "the screen asks for the code check first" */
      it("shows only the code and the confirm action before anything else", async () => {
        renderPage();

        await waitFor(() =>
          expect(screen.getByText("WDJB-MJHT")).toBeInTheDocument(),
        );
        expect(
          screen.getByRole("button", { name: "Confirm" }),
        ).toBeInTheDocument();
        expect(
          screen.getByText(/Confirm this matches the code shown in your/),
        ).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
        expect(screen.queryByText("What the CLI can access")).toBeNull();
      });
    });

    describe("when the user confirms the code", () => {
      /** @scenario "confirming the code reveals the access selection" */
      it("hides the code section and shows the access selection", async () => {
        const user = userEvent.setup();
        renderPage();
        await confirmCode(user);

        expect(screen.queryByText("WDJB-MJHT")).toBeNull();
        expect(
          screen.queryByText(/Confirm this matches the code shown in your/),
        ).toBeNull();
        expect(
          screen.getByRole("button", { name: "Approve" }),
        ).toBeInTheDocument();
        expect(screen.getByText("What the CLI can access")).toBeInTheDocument();
      });
    });

    describe("when a different code is opened in the same tab", () => {
      beforeEach(() => {
        bindingsRef.current = [
          { scopeType: "ORGANIZATION", scopeId: "org-1", role: "ADMIN" },
        ];
      });

      /** @scenario "a new device code starts the confirmation over" */
      it("returns to the confirmation step with no trace of the old flow", async () => {
        const user = userEvent.setup();
        const view = renderPage();
        await confirmCode(user);

        // The old code runs its whole course first: approve reaches the
        // success screen, so the reset below has real finished state to clear.
        await waitFor(() => expect(approveButton().disabled).toBe(false));
        await user.click(approveButton());
        await waitFor(() =>
          expect(screen.getByText("You're signed in!")).toBeInTheDocument(),
        );

        mockRouter.query = { user_code: "AAAA-BBBB" };
        view.rerender(pageElement());

        await waitFor(() =>
          expect(screen.getByText("AAAA-BBBB")).toBeInTheDocument(),
        );
        expect(
          screen.getByRole("button", { name: "Confirm" }),
        ).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
        expect(screen.queryByText("You're signed in!")).toBeNull();
        expect(
          screen.queryByText(/Confirm this matches the code shown in your/),
        ).toBeInTheDocument();
      });
    });
  });
});
