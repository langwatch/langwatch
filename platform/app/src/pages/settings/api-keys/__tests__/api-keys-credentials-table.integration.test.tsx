/**
 * @vitest-environment jsdom
 *
 * Integration tests for specs/api-keys/api-keys-credentials-table.feature —
 * the credentials table on Settings > API keys: the scope-kind chips and their
 * counts, the anatomy of a row, the revoke confirmation, and what the table
 * says while it is loading or after it has failed.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toaster } from "~/components/ui/toaster";
import { ApiKeysSection } from "../ApiKeysSection";

const mockRouterQuery: Record<string, string> = {};

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: mockRouterQuery,
    pathname: "/settings/api-keys",
    push: vi.fn(),
    replace: vi.fn(),
    isReady: true,
  }),
}));

const mockApiKeyList = vi.fn();
const mockOrgMembers = vi.fn();
const revokeMutate = vi.fn();

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({ apiKey: { list: { invalidate: vi.fn() } } }),
    apiKey: {
      list: { useQuery: () => mockApiKeyList() },
      myBindings: { useQuery: () => ({ data: [], isLoading: false }) },
      orgProjects: {
        useQuery: () => ({
          data: [
            { id: "proj-1", name: "Project Alpha", teamId: "team-1" },
            { id: "proj-2", name: "Project Beta", teamId: "team-2" },
          ],
          isLoading: false,
        }),
      },
      orgTeams: {
        useQuery: () => ({
          data: [
            { id: "team-1", name: "Team Red" },
            { id: "team-2", name: "Team Blue" },
          ],
          isLoading: false,
        }),
      },
      orgMembers: { useQuery: () => mockOrgMembers() },
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      update: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      revoke: {
        useMutation: () => ({ mutate: revokeMutate, isPending: false }),
      },
    },
    project: {
      regenerateApiKey: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  },
}));

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({
    data: { BASE_HOST: "https://app.langwatch.ai" },
    isLoading: false,
  }),
}));

// Built once in the factory closure: a fresh literal per call would give
// `organization` a new identity every render and spin useAvailableScopes into
// an endless render→effect→setState loop.
vi.mock("~/hooks/useOrganizationTeamProject", () => {
  const project = { id: "proj-1", name: "Project Alpha", apiKey: null };
  const organization = {
    id: "org-1",
    name: "Acme Corp",
    teams: [
      {
        id: "team-1",
        name: "Team Red",
        projects: [{ id: "proj-1", name: "Project Alpha" }],
      },
      {
        id: "team-2",
        name: "Team Blue",
        projects: [{ id: "proj-2", name: "Project Beta" }],
      },
    ],
  };
  const team = { id: "team-1", name: "Team Red" };
  return {
    useOrganizationTeamProject: () => ({
      project,
      organization,
      team,
      hasPermission: () => true,
    }),
  };
});

vi.mock("~/utils/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "u-1" } } }),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

/** jsdom ships no clipboard, so the copy control needs one to write into. */
const writeText = vi.fn();
Object.defineProperty(navigator, "clipboard", {
  value: { writeText },
  configurable: true,
});

type BindingSeed = { scopeType: string; scopeId: string; scopeName: string };

function makeKey({
  id,
  name,
  bindings,
  permissionMode = "all",
  userId = "u-1",
  userName = "Riley Chen",
  userEmail = "riley@example.com",
  lastUsedAt = null,
  expiresAt = null,
}: {
  id: string;
  name: string;
  bindings: BindingSeed[];
  permissionMode?: string;
  userId?: string | null;
  userName?: string | null;
  userEmail?: string | null;
  lastUsedAt?: Date | null;
  expiresAt?: Date | null;
}) {
  return {
    id,
    name,
    description: null,
    lookupIdPrefix: id.slice(0, 5),
    permissionMode,
    userId,
    userName: userId ? userName : null,
    userEmail: userId ? userEmail : null,
    createdByUserId: null,
    createdByUserName: null,
    createdAt: new Date("2026-01-01"),
    expiresAt,
    lastUsedAt,
    revokedAt: null,
    ingestSourceType: null,
    ingestionTemplateId: null,
    createdByDeviceLabel: null,
    roleBindings: bindings.map((binding) => ({
      id: `${id}-${binding.scopeId}`,
      role: "ADMIN",
      customRoleId: null,
      customRoleName: null,
      customRolePermissions: null,
      ...binding,
    })),
  };
}

const ORG_BINDING: BindingSeed = {
  scopeType: "ORGANIZATION",
  scopeId: "org-1",
  scopeName: "Acme Corp",
};
const TEAM_BINDING: BindingSeed = {
  scopeType: "TEAM",
  scopeId: "team-1",
  scopeName: "Team Red",
};
const PROJECT_BINDING: BindingSeed = {
  scopeType: "PROJECT",
  scopeId: "proj-1",
  scopeName: "Project Alpha",
};

const ORG_KEY = makeKey({
  id: "orgkey1",
  name: "Org Key",
  bindings: [ORG_BINDING],
});
const TEAM_KEY = makeKey({
  id: "teamkey1",
  name: "Team Key",
  bindings: [TEAM_BINDING],
});
const PROJECT_KEY = makeKey({
  id: "projkey1",
  name: "Project Key",
  bindings: [PROJECT_BINDING],
});

function renderSection() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ApiKeysSection organizationId="org-1" projectId="proj-1" />
    </ChakraProvider>,
  );
}

/** Opens a row's overflow menu and hands back the menu's items. */
async function openRowMenu(
  user: ReturnType<typeof userEvent.setup>,
  keyName: string,
) {
  await user.click(
    screen.getByRole("button", { name: `Actions for ${keyName}` }),
  );
  return screen.findByRole("menuitem", { name: "Revoke" });
}

describe("<ApiKeysSection /> credentials table", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockRouterQuery)) delete mockRouterQuery[key];
    mockOrgMembers.mockReturnValue({ data: [{ id: "u-1" }], isLoading: false });
    mockApiKeyList.mockReturnValue({
      data: [ORG_KEY, TEAM_KEY, PROJECT_KEY],
      isLoading: false,
    });
  });

  afterEach(() => cleanup());

  describe("given keys at every level of the organization", () => {
    describe("when the page loads", () => {
      /** @scenario The chip row counts the keys at each level of the organization */
      it("offers a chip per level, each carrying its own count", () => {
        renderSection();
        const chips = screen.getByTestId("scope-kind-chips");

        expect(
          within(chips).getByRole("button", { name: "All keys, 3 keys" }),
        ).toBeInTheDocument();
        expect(
          within(chips).getByRole("button", { name: "Organization, 1 key" }),
        ).toBeInTheDocument();
        expect(
          within(chips).getByRole("button", { name: "Team, 1 key" }),
        ).toBeInTheDocument();
        expect(
          within(chips).getByRole("button", { name: "Project, 1 key" }),
        ).toBeInTheDocument();
      });

      /** @scenario The chip row counts the keys at each level of the organization */
      it("emphasizes the all-keys chip", () => {
        renderSection();
        expect(
          screen.getByRole("button", { name: "All keys, 3 keys" }),
        ).toHaveAttribute("aria-pressed", "true");
      });

      /** @scenario The header says how many keys the filter is showing */
      it("says how many of the keys are on screen", () => {
        renderSection();
        expect(screen.getByTestId("api-keys-shown-count")).toHaveTextContent(
          "Showing 3 of 3 keys",
        );
      });
    });

    describe("when a level is picked", () => {
      /** @scenario Picking a level shows only the keys bound at that level */
      it("lists only the keys bound at that level", async () => {
        const user = userEvent.setup();
        renderSection();

        await user.click(screen.getByRole("button", { name: "Team, 1 key" }));

        expect(screen.getByText("Team Key")).toBeInTheDocument();
        expect(screen.queryByText("Org Key")).not.toBeInTheDocument();
        expect(screen.queryByText("Project Key")).not.toBeInTheDocument();
      });

      /** @scenario Picking a level shows only the keys bound at that level */
      it("moves the emphasis onto the picked chip", async () => {
        const user = userEvent.setup();
        renderSection();

        await user.click(screen.getByRole("button", { name: "Team, 1 key" }));

        expect(
          screen.getByRole("button", { name: "Team, 1 key" }),
        ).toHaveAttribute("aria-pressed", "true");
        expect(
          screen.getByRole("button", { name: "All keys, 3 keys" }),
        ).toHaveAttribute("aria-pressed", "false");
      });

      /** @scenario The header says how many keys the filter is showing */
      it("updates the count line to match", async () => {
        const user = userEvent.setup();
        renderSection();

        await user.click(screen.getByRole("button", { name: "Team, 1 key" }));

        expect(screen.getByTestId("api-keys-shown-count")).toHaveTextContent(
          "Showing 1 of 3 keys",
        );
      });
    });

    describe("when the picked level is picked again", () => {
      /** @scenario Picking the same chip twice returns to all keys */
      it("returns to every key", async () => {
        const user = userEvent.setup();
        renderSection();

        await user.click(screen.getByRole("button", { name: "Team, 1 key" }));
        await user.click(screen.getByRole("button", { name: "Team, 1 key" }));

        expect(screen.getByText("Org Key")).toBeInTheDocument();
        expect(screen.getByText("Project Key")).toBeInTheDocument();
        expect(
          screen.getByRole("button", { name: "All keys, 3 keys" }),
        ).toHaveAttribute("aria-pressed", "true");
      });
    });
  });

  describe("given every key sits on a project", () => {
    describe("when the page loads", () => {
      /** @scenario A level with no keys gets no chip */
      it("offers no chip for the levels holding nothing", () => {
        mockApiKeyList.mockReturnValue({
          data: [PROJECT_KEY],
          isLoading: false,
        });
        renderSection();
        const chips = screen.getByTestId("scope-kind-chips");

        expect(
          within(chips).getByRole("button", { name: "Project, 1 key" }),
        ).toBeInTheDocument();
        expect(
          within(chips).queryByRole("button", { name: /^Organization,/ }),
        ).not.toBeInTheDocument();
        expect(
          within(chips).queryByRole("button", { name: /^Team,/ }),
        ).not.toBeInTheDocument();
      });
    });
  });

  describe("given a key bound at the organization and on a project", () => {
    describe("when either level is picked", () => {
      /** @scenario A key bound at two levels is counted and shown under both */
      it("lists the key under both", async () => {
        const user = userEvent.setup();
        mockApiKeyList.mockReturnValue({
          data: [
            makeKey({
              id: "bothkey",
              name: "Reaches Both",
              bindings: [ORG_BINDING, PROJECT_BINDING],
            }),
          ],
          isLoading: false,
        });
        renderSection();

        await user.click(
          screen.getByRole("button", { name: "Organization, 1 key" }),
        );
        expect(screen.getByText("Reaches Both")).toBeInTheDocument();

        await user.click(
          screen.getByRole("button", { name: "Project, 1 key" }),
        );
        expect(screen.getByText("Reaches Both")).toBeInTheDocument();
      });
    });
  });

  describe("given the organization has keys but the scope picker hides all of them", () => {
    describe("when the table has nothing to show", () => {
      /** @scenario Narrowing to nothing explains why the table is empty */
      it("says no keys match the filter rather than that there are none", async () => {
        const user = userEvent.setup();
        mockApiKeyList.mockReturnValue({
          data: [
            makeKey({
              id: "elsewh",
              name: "Elsewhere Key",
              bindings: [
                {
                  scopeType: "PROJECT",
                  scopeId: "proj-2",
                  scopeName: "Project Beta",
                },
              ],
            }),
          ],
          isLoading: false,
        });
        renderSection();

        await user.click(screen.getByTestId("scope-filter"));
        await user.click(await screen.findByTestId("filter-this-project"));

        expect(
          await screen.findByText(/No keys match the current filter/),
        ).toBeInTheDocument();
        expect(
          screen.queryByText(/No API keys\. Create one to get started\./),
        ).not.toBeInTheDocument();
      });
    });
  });

  describe("given the organization has no keys at all", () => {
    describe("when the page renders", () => {
      it("invites the reader to create one", () => {
        mockApiKeyList.mockReturnValue({ data: [], isLoading: false });
        renderSection();

        expect(
          screen.getByText(/No API keys\. Create one to get started\./),
        ).toBeInTheDocument();
      });
    });
  });

  describe("given a row on screen", () => {
    describe("when the key cell renders", () => {
      /** @scenario A key row names the key and shows only the start of its secret */
      it("names the key and shows a truncated identifier beneath it", () => {
        renderSection();
        expect(screen.getByText("Org Key")).toBeInTheDocument();
        expect(screen.getByText("sk-lw-orgke…")).toBeInTheDocument();
      });

      /** @scenario The full secret is never shown after the key is created */
      it("shows nothing longer than the truncated identifier", () => {
        renderSection();
        const shown = screen
          .getAllByText(/^sk-lw-/)
          .map((element) => element.textContent ?? "");

        expect(shown).toHaveLength(3);
        for (const value of shown) {
          expect(value.endsWith("…")).toBe(true);
        }
      });

      /** @scenario Copying the shortened identifier says that is what was copied */
      it("labels the copy control as copying the identifier, not the key", () => {
        renderSection();
        expect(
          screen.getByRole("button", {
            name: "Copy the key identifier for Org Key",
          }),
        ).toBeInTheDocument();
        expect(
          screen.queryByRole("button", { name: /Copy the API key/ }),
        ).not.toBeInTheDocument();
      });

      /** @scenario Copying the shortened identifier says that is what was copied */
      it("confirms the identifier was copied, and copies only the identifier", async () => {
        const user = userEvent.setup();
        // userEvent installs its own clipboard stub during setup, so the spy
        // has to go in afterwards to be the one the component writes to.
        Object.defineProperty(navigator, "clipboard", {
          value: { writeText },
          configurable: true,
        });
        renderSection();

        await user.click(
          screen.getByRole("button", {
            name: "Copy the key identifier for Org Key",
          }),
        );

        expect(writeText).toHaveBeenCalledWith("sk-lw-orgke");
        expect(toaster.create).toHaveBeenCalledWith(
          expect.objectContaining({ title: "Key identifier copied" }),
        );
      });
    });

    describe("when the owner cell renders", () => {
      /** @scenario A personal key shows its owner */
      it("shows the owner's name for a personal key", () => {
        renderSection();
        expect(screen.getAllByText("Riley Chen").length).toBeGreaterThan(0);
      });

      /** @scenario A service key names itself in the owner column instead of rendering empty */
      it("says 'Service key' for a key that belongs to no person", () => {
        mockApiKeyList.mockReturnValue({
          data: [
            makeKey({
              id: "svckey1",
              name: "Service Key",
              bindings: [PROJECT_BINDING],
              userId: null,
            }),
          ],
          isLoading: false,
        });
        renderSection();
        expect(screen.getByText("Service key")).toBeInTheDocument();
      });
    });

    describe("when the key has never authenticated a request", () => {
      /** @scenario A key that has never been used says so */
      it("says 'Never used' rather than leaving the cell blank", () => {
        renderSection();
        expect(screen.getAllByText("Never used")).toHaveLength(3);
      });
    });

    describe("when the three permission modes render side by side", () => {
      /** @scenario The access column tells the three permission modes apart */
      it("gives each mode its own words", () => {
        mockApiKeyList.mockReturnValue({
          data: [
            makeKey({
              id: "allkey",
              name: "Full Key",
              bindings: [PROJECT_BINDING],
              permissionMode: "all",
            }),
            makeKey({
              id: "rokey1",
              name: "Reader Key",
              bindings: [PROJECT_BINDING],
              permissionMode: "readonly",
            }),
            makeKey({
              id: "reskey",
              name: "Narrow Key",
              bindings: [PROJECT_BINDING],
              permissionMode: "restricted",
            }),
          ],
          isLoading: false,
        });
        renderSection();

        expect(screen.getByText("Full access")).toBeInTheDocument();
        expect(screen.getByText("Read only")).toBeInTheDocument();
        expect(screen.getByText("Restricted")).toBeInTheDocument();
      });
    });

    describe("when a key reaches five projects", () => {
      /** @scenario A key that reaches many places does not spill a wall of chips */
      it("shows two scopes and counts the rest", () => {
        mockApiKeyList.mockReturnValue({
          data: [
            makeKey({
              id: "widekey",
              name: "Wide Key",
              bindings: Array.from({ length: 5 }, (_, index) => ({
                scopeType: "PROJECT",
                scopeId: `proj-${index}`,
                scopeName: `Project ${index}`,
              })),
            }),
          ],
          isLoading: false,
        });
        renderSection();

        expect(screen.getByText("Project 0")).toBeInTheDocument();
        expect(screen.getByText("Project 1")).toBeInTheDocument();
        expect(screen.getByText("+3 more")).toBeInTheDocument();
        expect(screen.queryByText("Project 4")).not.toBeInTheDocument();
      });
    });

    describe("when one key has expired and another has not", () => {
      /** @scenario An expired key is marked, an active one is not */
      it("marks only the expired one and gives the active one no marker", () => {
        mockApiKeyList.mockReturnValue({
          data: [
            makeKey({
              id: "goneke",
              name: "Stale Key",
              bindings: [PROJECT_BINDING],
              expiresAt: new Date("2020-01-01"),
            }),
            makeKey({
              id: "livek1",
              name: "Live Key",
              bindings: [PROJECT_BINDING],
            }),
          ],
          isLoading: false,
        });
        renderSection();

        expect(screen.getAllByText("Expired")).toHaveLength(1);
        expect(screen.queryByText("Active")).not.toBeInTheDocument();
      });
    });
  });

  describe("given a key the viewer may act on", () => {
    describe("when the row renders", () => {
      /** @scenario Row actions live behind one overflow menu */
      it("puts edit and revoke behind one trigger", async () => {
        const user = userEvent.setup();
        renderSection();

        expect(
          screen.queryByRole("button", { name: /^Edit API key/ }),
        ).not.toBeInTheDocument();

        await openRowMenu(user, "Org Key");

        expect(
          screen.getByRole("menuitem", { name: "Edit" }),
        ).toBeInTheDocument();
        expect(
          screen.getByRole("menuitem", { name: "Revoke" }),
        ).toBeInTheDocument();
      });
    });

    describe("when revoke is chosen from the menu", () => {
      /** @scenario Revoking asks before it acts */
      it("asks for confirmation and revokes nothing yet", async () => {
        const user = userEvent.setup();
        renderSection();

        await user.click(await openRowMenu(user, "Org Key"));

        expect(
          await screen.findByText(/Are you sure you want to revoke/),
        ).toBeInTheDocument();
        expect(revokeMutate).not.toHaveBeenCalled();
        expect(screen.getByText("Org Key")).toBeInTheDocument();
      });

      /** @scenario Confirming a revoke removes the key from the list */
      it("revokes the key once the question is answered", async () => {
        const user = userEvent.setup();
        renderSection();

        await user.click(await openRowMenu(user, "Org Key"));
        await user.click(await screen.findByRole("button", { name: "Revoke" }));

        expect(revokeMutate).toHaveBeenCalledWith(
          { organizationId: "org-1", apiKeyId: "orgkey1" },
          expect.anything(),
        );
      });

      /** @scenario Dismissing the revoke confirmation changes nothing */
      it("revokes nothing when the question is dismissed", async () => {
        const user = userEvent.setup();
        renderSection();

        await user.click(await openRowMenu(user, "Org Key"));
        await user.click(await screen.findByRole("button", { name: "Cancel" }));

        expect(revokeMutate).not.toHaveBeenCalled();
        expect(screen.getByText("Org Key")).toBeInTheDocument();
      });
    });
  });

  describe("given a key owned by someone else and no administrator rights", () => {
    describe("when the row renders", () => {
      /** @scenario A key I may not act on offers no menu */
      it("offers no overflow menu at all", () => {
        mockOrgMembers.mockReturnValue({ data: [], isLoading: false });
        mockApiKeyList.mockReturnValue({
          data: [
            makeKey({
              id: "otherk",
              name: "Someone Else's Key",
              bindings: [PROJECT_BINDING],
              userId: "u-2",
            }),
          ],
          isLoading: false,
        });
        renderSection();

        expect(screen.getByText("Someone Else's Key")).toBeInTheDocument();
        expect(
          screen.queryByRole("button", { name: /^Actions for/ }),
        ).not.toBeInTheDocument();
      });
    });
  });

  describe("given the keys cannot be loaded", () => {
    describe("when the page renders", () => {
      /** @scenario A failed load explains itself instead of showing an empty table */
      it("shows an error notice and no 'no API keys' message", () => {
        mockApiKeyList.mockReturnValue({
          data: undefined,
          isLoading: false,
          error: new Error("the list did not come back"),
        });
        renderSection();

        expect(screen.getByTestId("section-error-notice")).toBeInTheDocument();
        expect(
          screen.queryByText(/No API keys\. Create one to get started\./),
        ).not.toBeInTheDocument();
      });
    });
  });

  describe("given the keys are still loading", () => {
    describe("when the page renders", () => {
      /** @scenario While the list is loading the table does not claim the organization has no keys */
      it("says it is loading instead of claiming there are none", () => {
        mockApiKeyList.mockReturnValue({ data: undefined, isLoading: true });
        renderSection();

        expect(screen.getByText("Loading API keys")).toBeInTheDocument();
        expect(
          screen.queryByText(/No API keys\. Create one to get started\./),
        ).not.toBeInTheDocument();
      });
    });
  });
});
