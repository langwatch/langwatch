/**
 * @vitest-environment jsdom
 *
 * Covers specs/ai-gateway/governance/workspace-switcher.feature, the
 * empty-team create-affordance scenarios, through the REAL data derivation:
 * the exact coding-usage signup org shape (personal team + one shared team
 * with no projects) flows from the tRPC boundary through the real
 * useWorkspaceData + useOrganizationTeamProject + useDrawer into the real
 * WorkspaceSwitcher. Only the network boundary is mocked.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sessionRef } = vi.hoisted(() => ({
  sessionRef: {
    current: {
      data: { user: { id: "user-1", email: "dev@example.com" } },
      status: "authenticated" as const,
    },
  },
}));

vi.mock("~/utils/auth-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/utils/auth-client")>();
  return { ...actual, useSession: () => sessionRef.current };
});

// The founder-reported shape: governance signup, org ADMIN, personal team
// provisioned, one shared team with zero projects.
const organizationsFixture = [
  {
    id: "org-1",
    name: "Acme Org",
    slug: "acme-org",
    members: [{ userId: "user-1", role: "ADMIN" }],
    teams: [
      {
        id: "team-personal",
        slug: "personal-team",
        name: "Personal Workspace",
        isPersonal: true,
        ownerUserId: "user-1",
        members: [{ userId: "user-1", role: "ADMIN" }],
        projects: [
          {
            id: "proj-personal",
            slug: "personal-proj",
            name: "Personal project",
            isPersonal: true,
          },
        ],
      },
      {
        id: "team-shared",
        slug: "acme-org-team",
        name: "Acme Org Team",
        isPersonal: false,
        ownerUserId: null,
        members: [{ userId: "user-1", role: "ADMIN" }],
        projects: [],
      },
    ],
  },
];

vi.mock("~/utils/api", () => ({
  api: {
    publicEnv: { useQuery: () => ({ data: {}, isLoading: false }) },
    sharedTrace: {
      get: { useQuery: () => ({ data: undefined, isLoading: false }) },
    },
    organization: {
      getAll: {
        useQuery: () => ({
          data: organizationsFixture,
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
    featureFlag: {
      isEnabledForEachOrganization: {
        useQuery: () => ({
          data: { enabledByOrganizationId: { "org-1": true } },
          isLoading: false,
        }),
      },
    },
  },
}));

import { useRouter } from "~/utils/compat/next-router";
import { useWorkspaceData } from "../useWorkspaceData";
import { WorkspaceSwitcher } from "../WorkspaceSwitcher";

const mockRouter = useRouter();

function Harness() {
  const data = useWorkspaceData();
  return <WorkspaceSwitcher {...data} current={{ kind: "personal" }} />;
}

describe("workspace switcher for a coding-usage signup with an empty shared team", () => {
  beforeEach(() => {
    (mockRouter.push as unknown as Mock).mockClear();
    mockRouter.pathname = "/me";
    mockRouter.route = "/me";
    mockRouter.asPath = "/me";
  });

  afterEach(() => {
    cleanup();
  });

  /** @scenario A coding-usage signup can always create their first shared project from the workspace menu */
  it("derives the empty shared team as creatable and opens the create-project drawer", async () => {
    const user = userEvent.setup();
    render(
      <ChakraProvider value={defaultSystem}>
        <Harness />
      </ChakraProvider>,
    );

    await user.click(screen.getByRole("button", { name: /switch workspace/i }));

    // The empty shared team renders, with its create affordance.
    expect(await screen.findByText("Acme Org Team")).toBeInTheDocument();
    const addButton = await screen.findByRole("button", {
      name: /create project in acme org team/i,
    });

    // #6190 invariant: the personal team never appears as a switcher row.
    expect(screen.queryByText("Personal Workspace")).not.toBeInTheDocument();
    expect(screen.queryByText("Personal project")).not.toBeInTheDocument();

    await user.click(addButton);

    // The click lands on the create-project drawer, scoped by URL params.
    const pushedUrls = (mockRouter.push as unknown as Mock).mock.calls.map((call) =>
      String(call[0]),
    );
    expect(pushedUrls.some((url) => url.includes("drawer.open=createProject"))).toBe(
      true,
    );
  });
});
