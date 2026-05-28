/**
 * @vitest-environment jsdom
 *
 * Integration tests for scope-filter.feature — API Keys page.
 *
 * Verifies that:
 *  - The scope filter control renders in the header with "All you can see" default
 *  - All keys appear with the default "All you can see" filter
 *  - Selecting a scope narrows the table using the inclusive cascade
 *  - Zero-match state shows a plain empty message (no reset link)
 *  - Filter persists via URL query param (?scope=TYPE:id)
 *
 * Uses a mocked tRPC layer and a controlled router mock that allows
 * setting query params per-test.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiKeysSection } from "../ApiKeysSection";

// ---------------------------------------------------------------------------
// Mutable mock router — tests can set query params before rendering
// ---------------------------------------------------------------------------
const mockRouterQuery: Record<string, string> = {};
const mockRouterPush = vi.fn();
const mockRouterReplace = vi.fn();

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: mockRouterQuery,
    pathname: "/settings/api-keys",
    push: mockRouterPush,
    replace: mockRouterReplace,
    isReady: true,
  }),
}));

// ---------------------------------------------------------------------------
// tRPC mock
// ---------------------------------------------------------------------------
const mockApiKeyList = vi.fn();

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      apiKey: {
        list: { invalidate: vi.fn() },
      },
    }),
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
      orgMembers: { useQuery: () => ({ data: [{ id: "u-1" }], isLoading: false }) },
      create: {
        useMutation: () => ({
          mutate: vi.fn(),
          isLoading: false,
          isPending: false,
        }),
      },
      update: {
        useMutation: () => ({
          mutate: vi.fn(),
          isLoading: false,
          isPending: false,
        }),
      },
      revoke: {
        useMutation: () => ({
          mutate: vi.fn(),
          isLoading: false,
          isPending: false,
        }),
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

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", name: "Project Alpha", apiKey: null },
    organization: {
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
    },
    team: { id: "team-1", name: "Team Red" },
    hasPermission: () => true,
  }),
}));

vi.mock("~/utils/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "u-1" } } }),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Fake API key data
// ---------------------------------------------------------------------------

function makeKey(
  id: string,
  name: string,
  roleBindings: Array<{ scopeType: string; scopeId: string; role?: string; scopeName?: string }>,
) {
  return {
    id,
    name,
    description: null,
    userId: "u-1",
    userEmail: "test@example.com",
    userName: "Test User",
    lookupIdPrefix: id.slice(-4),
    createdAt: new Date("2026-01-01"),
    expiresAt: null,
    lastUsedAt: null,
    permissionMode: "all",
    roleBindings: roleBindings.map((rb) => ({
      role: rb.role ?? "ADMIN",
      scopeType: rb.scopeType,
      scopeId: rb.scopeId,
      scopeName: rb.scopeName ?? null,
      customRoleId: null,
      customRolePermissions: null,
    })),
  };
}

const ORG_KEY = makeKey("key-org", "Org-Level Key", [
  { scopeType: "ORGANIZATION", scopeId: "org-1", scopeName: "Acme Corp" },
]);

const TEAM_RED_KEY = makeKey("key-team-red", "Team Red Key", [
  { scopeType: "TEAM", scopeId: "team-1", scopeName: "Team Red" },
]);

const TEAM_BLUE_KEY = makeKey("key-team-blue", "Team Blue Key", [
  { scopeType: "TEAM", scopeId: "team-2", scopeName: "Team Blue" },
]);

const PROJ_ALPHA_KEY = makeKey("key-proj-alpha", "Project Alpha Key", [
  { scopeType: "PROJECT", scopeId: "proj-1", scopeName: "Project Alpha" },
]);

const PROJ_BETA_KEY = makeKey("key-proj-beta", "Project Beta Key", [
  { scopeType: "PROJECT", scopeId: "proj-2", scopeName: "Project Beta" },
]);

const MULTI_BINDING_KEY = makeKey("key-multi", "Multi-Binding Key", [
  { scopeType: "ORGANIZATION", scopeId: "org-1", scopeName: "Acme Corp" },
  { scopeType: "PROJECT", scopeId: "proj-2", scopeName: "Project Beta" },
]);

const ALL_KEYS = [
  ORG_KEY,
  TEAM_RED_KEY,
  TEAM_BLUE_KEY,
  PROJ_ALPHA_KEY,
  PROJ_BETA_KEY,
  MULTI_BINDING_KEY,
];

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderSection() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ApiKeysSection organizationId="org-1" projectId="proj-1" />
    </ChakraProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("<ApiKeysSection /> scope filter", () => {
  beforeEach(() => {
    mockApiKeyList.mockReturnValue({ data: ALL_KEYS, isLoading: false });
    mockRouterPush.mockReset();
    mockRouterReplace.mockReset();
    // Reset mutable router query
    for (const k of Object.keys(mockRouterQuery)) {
      delete mockRouterQuery[k];
    }
  });

  afterEach(() => cleanup());

  describe("given the default view", () => {
    describe("when navigating to Settings > API Keys", () => {
      /** @scenario Filter defaults to "All you can see" */
      it("renders the scope filter control in the header reading 'All you can see'", () => {
        renderSection();
        const filter = screen.getByTestId("scope-filter");
        expect(filter).toBeInTheDocument();
        expect(filter).toHaveTextContent("All you can see");
      });

      /** @scenario Filter defaults to "All you can see" */
      it("renders every API key in the table", () => {
        renderSection();
        expect(screen.getByText("Org-Level Key")).toBeInTheDocument();
        expect(screen.getByText("Team Red Key")).toBeInTheDocument();
        expect(screen.getByText("Team Blue Key")).toBeInTheDocument();
        expect(screen.getByText("Project Alpha Key")).toBeInTheDocument();
        expect(screen.getByText("Project Beta Key")).toBeInTheDocument();
        expect(screen.getByText("Multi-Binding Key")).toBeInTheDocument();
      });

      /** @scenario Filter defaults to "All you can see" */
      it("positions the scope filter in the header row before the Create button", () => {
        renderSection();
        const filter = screen.getByTestId("scope-filter");
        const createBtn = screen.getByText(/Create new secret key/i);
        // Both are in the DOM; filter appears before create in document order
        const position = filter.compareDocumentPosition(createBtn);
        // DOCUMENT_POSITION_FOLLOWING means createBtn comes after filter
        expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      });
    });
  });

  describe("given keys at all scope levels", () => {
    describe("when the filter is 'All you can see'", () => {
      /** @scenario Selecting "All you can see" shows every visible key regardless of scope */
      it("shows keys with org-scoped bindings", () => {
        renderSection();
        expect(screen.getByText("Org-Level Key")).toBeInTheDocument();
      });

      /** @scenario Selecting "All you can see" shows every visible key regardless of scope */
      it("shows keys with team-scoped bindings", () => {
        renderSection();
        expect(screen.getByText("Team Red Key")).toBeInTheDocument();
      });

      /** @scenario Selecting "All you can see" shows every visible key regardless of scope */
      it("shows keys with project-scoped bindings", () => {
        renderSection();
        expect(screen.getByText("Project Alpha Key")).toBeInTheDocument();
      });
    });
  });

  describe("given the filter dropdown is opened", () => {
    describe("when checking dropdown options", () => {
      /** @scenario Scope filter dropdown offers the same options as the model-providers page */
      it("offers 'All you can see', 'This Team', 'This Project', and 'More Scopes'", async () => {
        renderSection();
        const trigger = screen.getByTestId("scope-filter");
        fireEvent.click(trigger);
        await waitFor(() => {
          expect(screen.getByTestId("filter-all")).toBeInTheDocument();
          expect(screen.getByTestId("filter-this-team")).toBeInTheDocument();
          expect(screen.getByTestId("filter-this-project")).toBeInTheDocument();
          expect(screen.getByTestId("filter-more-scopes")).toBeInTheDocument();
        });
      });
    });
  });

  describe("given keys with bindings at all scope levels", () => {
    describe("when picking the organization scope", () => {
      /** @scenario Picking the organization keeps every key bound anywhere in that org */
      it("keeps keys with organization-scoped bindings", async () => {
        const user = userEvent.setup();
        renderSection();
        const trigger = screen.getByTestId("scope-filter");
        await user.click(trigger);
        await waitFor(() =>
          expect(screen.getByTestId("filter-more-scopes")).toBeInTheDocument(),
        );
        await user.click(screen.getByTestId("filter-more-scopes"));
        await waitFor(() =>
          expect(
            screen.getByTestId("filter-scope-organization-acme corp"),
          ).toBeInTheDocument(),
        );
        await user.click(
          screen.getByTestId("filter-scope-organization-acme corp"),
        );

        await waitFor(() => {
          expect(screen.getByText("Org-Level Key")).toBeInTheDocument();
          expect(screen.getByText("Team Red Key")).toBeInTheDocument();
          expect(screen.getByText("Team Blue Key")).toBeInTheDocument();
          expect(screen.getByText("Project Alpha Key")).toBeInTheDocument();
          expect(screen.getByText("Project Beta Key")).toBeInTheDocument();
          expect(screen.getByText("Multi-Binding Key")).toBeInTheDocument();
        });
      });
    });

    describe("when picking a specific team scope", () => {
      /** @scenario Picking a team keeps org-scoped parents, the team itself, and its child projects */
      it("keeps org parent keys, the team key, and child project keys — hides sibling team/project keys", async () => {
        const user = userEvent.setup();
        renderSection();
        const trigger = screen.getByTestId("scope-filter");
        await user.click(trigger);
        await waitFor(() =>
          expect(screen.getByTestId("filter-more-scopes")).toBeInTheDocument(),
        );
        await user.click(screen.getByTestId("filter-more-scopes"));
        await waitFor(() =>
          expect(
            screen.getByTestId("filter-scope-team-team red"),
          ).toBeInTheDocument(),
        );
        await user.click(screen.getByTestId("filter-scope-team-team red"));

        await waitFor(() => {
          // org parent stays
          expect(screen.getByText("Org-Level Key")).toBeInTheDocument();
          // picked team stays
          expect(screen.getByText("Team Red Key")).toBeInTheDocument();
          // child project stays
          expect(screen.getByText("Project Alpha Key")).toBeInTheDocument();
          // sibling team and its project are hidden
          expect(screen.queryByText("Team Blue Key")).not.toBeInTheDocument();
          expect(screen.queryByText("Project Beta Key")).not.toBeInTheDocument();
        });
      });
    });

    describe("when picking a specific project scope", () => {
      /** @scenario Picking a project keeps org-scoped grand-parents, the project's parent team, and the project itself */
      it("keeps org grandparent, parent team key, and the project key — hides sibling project and other team keys", async () => {
        const user = userEvent.setup();
        renderSection();
        const trigger = screen.getByTestId("scope-filter");
        await user.click(trigger);
        await waitFor(() =>
          expect(screen.getByTestId("filter-more-scopes")).toBeInTheDocument(),
        );
        await user.click(screen.getByTestId("filter-more-scopes"));
        await waitFor(() =>
          expect(
            screen.getByTestId("filter-scope-project-project alpha"),
          ).toBeInTheDocument(),
        );
        await user.click(
          screen.getByTestId("filter-scope-project-project alpha"),
        );

        await waitFor(() => {
          // org grandparent stays
          expect(screen.getByText("Org-Level Key")).toBeInTheDocument();
          // parent team stays
          expect(screen.getByText("Team Red Key")).toBeInTheDocument();
          // picked project stays
          expect(screen.getByText("Project Alpha Key")).toBeInTheDocument();
          // sibling project is hidden
          expect(
            screen.queryByText("Project Beta Key"),
          ).not.toBeInTheDocument();
          // unrelated team is hidden
          expect(
            screen.queryByText("Team Blue Key"),
          ).not.toBeInTheDocument();
        });
      });
    });

    describe("when a key has multiple bindings", () => {
      /** @scenario A key with multiple bindings is visible if any binding matches the cascade */
      it("keeps the key visible if any binding matches the cascade", async () => {
        // MULTI_BINDING_KEY has org + proj-2 bindings
        // When filtering to team-1 (which has proj-1, not proj-2):
        //   - org binding matches => key should be visible
        const user = userEvent.setup();
        renderSection();
        const trigger = screen.getByTestId("scope-filter");
        await user.click(trigger);
        await waitFor(() =>
          expect(screen.getByTestId("filter-more-scopes")).toBeInTheDocument(),
        );
        await user.click(screen.getByTestId("filter-more-scopes"));
        await waitFor(() =>
          expect(
            screen.getByTestId("filter-scope-team-team red"),
          ).toBeInTheDocument(),
        );
        await user.click(screen.getByTestId("filter-scope-team-team red"));

        await waitFor(() => {
          // Multi-binding key has org binding which matches team-red cascade
          expect(screen.getByText("Multi-Binding Key")).toBeInTheDocument();
        });
      });
    });
  });

  describe("given no keys exist for the filtered scope", () => {
    describe("when the filter narrows everything away", () => {
      /** @scenario Filter with zero matches shows a plain empty state */
      it("shows a plain empty state message without a reset link", async () => {
        // Use a key that only has proj-1 binding, then filter to proj-2
        // proj-2 is under team-2; proj-1's binding does NOT cascade to proj-2
        mockApiKeyList.mockReturnValue({
          data: [PROJ_ALPHA_KEY],
          isLoading: false,
        });

        const user = userEvent.setup();
        renderSection();
        const trigger = screen.getByTestId("scope-filter");
        await user.click(trigger);
        await waitFor(() =>
          expect(screen.getByTestId("filter-more-scopes")).toBeInTheDocument(),
        );
        await user.click(screen.getByTestId("filter-more-scopes"));
        await waitFor(() =>
          expect(
            screen.getByTestId("filter-scope-project-project beta"),
          ).toBeInTheDocument(),
        );
        await user.click(
          screen.getByTestId("filter-scope-project-project beta"),
        );

        await waitFor(() => {
          // PROJ_ALPHA_KEY has proj-1 binding only.
          // Filtering to proj-2 means: org parents + team-2 + proj-2 are visible.
          // proj-1 binding doesn't match any of those → no keys visible.
          expect(
            screen.getByText(/no keys match/i),
          ).toBeInTheDocument();
        });

        // No "Show all" reset link — user must use the dropdown to reset
        expect(screen.queryByText(/show all/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/reset/i)).not.toBeInTheDocument();
      });
    });
  });

  describe("given the URL has a scope query param", () => {
    describe("when navigating to API Keys with ?scope=TEAM:team-1", () => {
      /** @scenario Filter selection survives reload via the URL, not localStorage */
      it("reapplies the team-scoped filter from URL on mount", async () => {
        mockRouterQuery.scope = "TEAM:team-1";

        renderSection();

        await waitFor(() => {
          const filter = screen.getByTestId("scope-filter");
          expect(filter).toHaveTextContent("Team:");
        });
      });
    });
  });
});
