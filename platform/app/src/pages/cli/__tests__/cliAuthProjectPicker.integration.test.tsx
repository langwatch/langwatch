/**
 * @vitest-environment jsdom
 *
 * Covers specs/ai-governance/cli-onboarding/authorize-project-picker.feature.
 *
 * The real /cli/auth page runs in project_api_key mode against three org
 * shapes: no shared projects (personal preselected + create action), shared
 * projects (personal as an explicit entry, never implied), and a freshly
 * switched org where nothing matches the ambient project (zero-selected
 * state reads "None selected"). Only the network boundary is replaced:
 * `fetch` answers like the CLI auth REST endpoints and the tRPC hooks
 * resolve fixtures. The CreateProjectDrawer is stubbed at its module seam
 * (it has its own tests); under test here is that the page offers it with
 * no ambient project and adopts the project it reports created.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock, sessionRef, orgsRef } = vi.hoisted(() => {
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
    project: {
      getHasFirstMessage: {
        useQuery: () => ({ data: undefined, isLoading: false }),
      },
    },
  },
}));

// The drawer's own behavior (form, mutation, toasts) is covered by
// CreateProjectDrawer.test.tsx; the page contract under test is that it gets
// an organizationId with NO ambient project and that onCreated adoption
// works, so the stub surfaces exactly that seam.
const drawerProps: Array<Record<string, unknown>> = [];
vi.mock("~/components/projects/CreateProjectDrawer", () => ({
  CreateProjectDrawer: (props: {
    organizationId?: string;
    onClose?: () => void;
    onCreated?: (result: { projectSlug: string }) => void;
  }) => {
    drawerProps.push(props);
    return (
      <div role="dialog" aria-label="Create New Project">
        <button
          type="button"
          onClick={() => props.onCreated?.({ projectSlug: "fresh-proj" })}
        >
          simulate create
        </button>
      </div>
    );
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

const sharedTeam = (projects: Array<Record<string, unknown>>) => ({
  id: "team-shared",
  slug: "shared-team",
  name: "Engineering",
  isPersonal: false,
  ownerUserId: null,
  projects,
});

const sharedProject = (id: string, name: string) => ({
  id,
  slug: id,
  name,
  isPersonal: false,
  kind: "application",
});

/** The org under test, whose team shape each scenario varies. */
const acmeOrg = (teams: Array<Record<string, unknown>>) => ({
  id: "org-1",
  name: "Acme Org",
  teams,
});

/** A first org whose sole project becomes the AMBIENT one (the hook's
 * fallback picks orgs[0].teams first project), so the org under test can be
 * exercised with a non-matching ambient slug: exactly the shape where the
 * picker legitimately has nothing selected. */
const homeOrg = {
  id: "org-home",
  name: "Home Org",
  teams: [
    {
      id: "team-home",
      slug: "team-home",
      name: "Home",
      isPersonal: false,
      ownerUserId: null,
      projects: [sharedProject("home-proj", "Home Project")],
    },
  ],
};

const approveBodies: Array<Record<string, unknown>> = [];

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
            credential_type: "project_api_key",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/api/auth/cli/approve")) {
        approveBodies.push(
          JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
        );
        return new Response(JSON.stringify({ ok: true, kind: "api_key" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
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
  screen.getByRole("button", { name: "Send API key" }) as HTMLButtonElement;

beforeEach(() => {
  fetchMock.mockReset();
  (mockRouter.push as unknown as Mock).mockClear();
  (mockRouter.replace as unknown as Mock).mockClear();
  mockRouter.query = { user_code: "WDJB-MJHT" };
  approveBodies.length = 0;
  drawerProps.length = 0;
  window.localStorage.clear();
  serveCliAuthEndpoints();
});

afterEach(() => {
  cleanup();
  mockRouter.query = {};
});

describe("/cli/auth project picker, given an organization with no shared projects", () => {
  beforeEach(() => {
    orgsRef.current = [acmeOrg([personalTeam, sharedTeam([])])];
  });

  /** @scenario a user with no shared projects gets their personal project preselected */
  it("preselects the personal project, explains it, and enables the approve button", async () => {
    renderPage();

    await waitFor(() =>
      expect(screen.getAllByText("Personal Workspace").length).toBeGreaterThan(
        0,
      ),
    );
    expect(
      screen.getByText(/your personal project is preselected/i),
    ).toBeDefined();
    await waitFor(() => expect(approveButton().disabled).toBe(false));
  });

  /** @scenario the no-shared-projects state offers a create-project action */
  it("offers Create project, passes the picked org, and adopts the created project", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Create project/i }),
      ).toBeDefined(),
    );
    await user.click(screen.getByRole("button", { name: /Create project/i }));

    await waitFor(() =>
      expect(
        screen.getByRole("dialog", { name: "Create New Project" }),
      ).toBeDefined(),
    );
    expect(drawerProps[0]?.organizationId).toBe("org-1");

    // The refreshed org list (the real drawer invalidates organization
    // queries) carries the new project by the time creation is reported.
    act(() => {
      orgsRef.current = [
        acmeOrg([
          personalTeam,
          sharedTeam([sharedProject("fresh-proj", "Fresh Project")]),
        ]),
      ];
    });
    await user.click(screen.getByRole("button", { name: "simulate create" }));

    await waitFor(() =>
      expect(screen.getAllByText("Fresh Project").length).toBeGreaterThan(0),
    );
    await waitFor(() => expect(approveButton().disabled).toBe(false));
    await user.click(approveButton());
    await waitFor(() => expect(approveBodies.length).toBe(1));
    expect(approveBodies[0]?.project_id).toBe("fresh-proj");
  });

  /** @scenario approving with the personal project selected returns the personal project key */
  it("approves with the preselected personal project id", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() =>
      expect(screen.getAllByText("Personal Workspace").length).toBeGreaterThan(
        0,
      ),
    );
    await waitFor(() => expect(approveButton().disabled).toBe(false));
    await user.click(approveButton());

    await waitFor(() => expect(approveBodies.length).toBe(1));
    expect(approveBodies[0]?.project_id).toBe("proj-personal");
    expect(approveBodies[0]?.organization_id).toBe("org-1");
  });
});

describe("/cli/auth project picker, given a switched-to organization whose projects do not match the ambient one", () => {
  const user = userEvent.setup();

  beforeEach(async () => {
    orgsRef.current = [
      homeOrg,
      acmeOrg([
        personalTeam,
        sharedTeam([
          sharedProject("proj-a", "Alpha"),
          sharedProject("proj-b", "Beta"),
        ]),
      ]),
    ];
    renderPage();
    // Two orgs render the org chooser; move onto the org under test. Its
    // offered projects cannot match the ambient project (Home Org's), so
    // the picker legitimately starts with nothing selected.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Acme Org" })).toBeDefined(),
    );
    await user.click(screen.getByRole("button", { name: "Acme Org" }));
  });

  /** @scenario zero selected reads "None selected", never "Multiple" */
  it("shows None selected (never Multiple) while nothing is picked, and disables approve", async () => {
    await waitFor(() =>
      expect(screen.getAllByText("None selected").length).toBeGreaterThan(0),
    );
    expect(screen.queryByText("Multiple")).toBeNull();
    expect(approveButton().disabled).toBe(true);
  });

  /** @scenario a user with shared projects sees personal as an explicit entry, not an implication */
  it("lists shared projects under their team and personal under a Personal group", async () => {
    await waitFor(() =>
      expect(screen.getAllByText("None selected").length).toBeGreaterThan(0),
    );

    expect(screen.getAllByText("Alpha").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Beta").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Engineering").length).toBeGreaterThan(0);
    // The personal entry rides its own explicit group label.
    expect(screen.getAllByText("Personal").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Personal Workspace").length).toBeGreaterThan(0);
  });

  it("approves with an explicitly picked personal project", async () => {
    await waitFor(() =>
      expect(screen.getAllByText("None selected").length).toBeGreaterThan(0),
    );
    // Chakra's Select renders its options in the collection; picking the
    // personal entry is an explicit act, never implied by the team pick.
    await user.click(screen.getByRole("combobox"));
    const personalOption = await screen.findByRole("option", {
      name: /Personal Workspace/,
    });
    await user.click(personalOption);

    await waitFor(() => expect(approveButton().disabled).toBe(false));
    await user.click(approveButton());

    await waitFor(() => expect(approveBodies.length).toBe(1));
    expect(approveBodies[0]?.project_id).toBe("proj-personal");
  });
});
