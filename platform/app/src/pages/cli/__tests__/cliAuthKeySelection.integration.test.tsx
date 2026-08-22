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
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultCliKeyPermissions } from "../../../server/api-key/cli-key-defaults";

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
  fetchMock.mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
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
        return new Response(
          JSON.stringify({ ok: true, kind: "device_session" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  );
};

const renderPage = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <CliAuthPage />
    </ChakraProvider>,
  );

const approveButton = () =>
  screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement;

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

    await waitFor(() => expect(approveButton().disabled).toBe(false));
    await user.click(approveButton());

    await waitFor(() => expect(approveBodies.length).toBe(1));
    const permissions = approveBodies[0]?.key_selection?.permissions ?? [];
    // The literal set the scenario names, so removing one from the constant
    // fails here instead of passing vacuously.
    for (const excluded of [
      "organization:manage",
      "organization:delete",
      "project:create",
      "project:delete",
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
