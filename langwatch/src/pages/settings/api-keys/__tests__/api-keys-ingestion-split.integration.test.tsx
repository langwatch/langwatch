/**
 * @vitest-environment jsdom
 *
 * Integration tests for the "Ingestion keys vs API keys" split on the
 * Settings > API Keys page (unified-api-keys.feature).
 *
 * An ingestion key is an ApiKey row with `ingestSourceType` set non-null: a
 * project-scoped, ingest-only write credential the `langwatch <tool>` CLI
 * mints. Regular API / service keys have `ingestSourceType == null`. The page
 * renders the two kinds in two labeled sections.
 *
 * Verifies that:
 *  - Ingestion keys render under their own "Ingestion keys" heading, show the
 *    source tool, and expose revoke but no permissions/scope editor.
 *  - Regular keys render under the "API keys" heading.
 *  - With no ingestion keys, no "Ingestion keys" heading appears (no change).
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiKeysSection } from "../ApiKeysSection";

// ---------------------------------------------------------------------------
// Router mock (no query params needed for these tests)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// tRPC mock
// ---------------------------------------------------------------------------
const mockApiKeyList = vi.fn();

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      apiKey: { list: { invalidate: vi.fn() } },
    }),
    apiKey: {
      list: { useQuery: () => mockApiKeyList() },
      myBindings: { useQuery: () => ({ data: [], isLoading: false }) },
      orgProjects: { useQuery: () => ({ data: [], isLoading: false }) },
      orgTeams: { useQuery: () => ({ data: [], isLoading: false }) },
      orgMembers: { useQuery: () => ({ data: [{ id: "u-1" }], isLoading: false }) },
      create: { useMutation: () => ({ mutate: vi.fn(), isLoading: false }) },
      update: { useMutation: () => ({ mutate: vi.fn(), isLoading: false }) },
      revoke: { useMutation: () => ({ mutate: vi.fn(), isLoading: false }) },
    },
  },
}));

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({
    data: { BASE_HOST: "https://app.langwatch.ai" },
    isLoading: false,
  }),
}));

// Built once in the factory closure and returned by reference on every call —
// a fresh literal per call busts the useMemo([organization]) inside
// useAvailableScopes and hangs the worker. See the sibling scope-filter test.
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

// ---------------------------------------------------------------------------
// Fake API key data
// ---------------------------------------------------------------------------

function makeRegularKey(id: string, name: string) {
  return {
    id,
    name,
    description: null,
    userId: "u-1",
    userEmail: "jane@acme.com",
    userName: "Jane",
    lookupIdPrefix: id.slice(-4),
    createdAt: new Date("2026-01-01"),
    expiresAt: null,
    lastUsedAt: null,
    permissionMode: "all",
    ingestSourceType: null,
    ingestionTemplateId: null,
    roleBindings: [
      {
        role: "ADMIN",
        scopeType: "ORGANIZATION",
        scopeId: "org-1",
        scopeName: "Acme Corp",
        customRoleId: null,
        customRolePermissions: null,
      },
    ],
  };
}

function makeIngestionKey(id: string, name: string, sourceType: string) {
  return {
    id,
    name,
    description: null,
    // Ingestion keys are project credentials with no owning user.
    userId: null,
    userEmail: null,
    userName: null,
    lookupIdPrefix: id.slice(-4),
    createdAt: new Date("2026-02-01"),
    expiresAt: null,
    lastUsedAt: null,
    permissionMode: "restricted",
    ingestSourceType: sourceType,
    ingestionTemplateId: null,
    roleBindings: [
      {
        role: "CUSTOM",
        scopeType: "PROJECT",
        scopeId: "proj-1",
        scopeName: "Project Alpha",
        customRoleId: "role-ingest",
        customRolePermissions: ["traces:create"],
      },
    ],
  };
}

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

describe("<ApiKeysSection /> ingestion-key split", () => {
  beforeEach(() => {
    for (const k of Object.keys(mockRouterQuery)) delete mockRouterQuery[k];
  });
  afterEach(() => cleanup());

  describe("given the org has an ingestion key and a regular key", () => {
    describe("when navigating to Settings > API Keys", () => {
      /** @scenario Ingestion keys render in their own labeled section */
      it("renders an 'Ingestion keys' heading and an 'API keys' heading", () => {
        mockApiKeyList.mockReturnValue({
          data: [
            makeIngestionKey("key-ingest", "claude_code ingest", "claude_code"),
            makeRegularKey("key-ci", "CI Pipeline"),
          ],
          isLoading: false,
        });
        renderSection();

        expect(
          screen.getByRole("heading", { name: "Ingestion keys" }),
        ).toBeInTheDocument();
        expect(
          screen.getByRole("heading", { name: "API keys" }),
        ).toBeInTheDocument();
      });

      /** @scenario Ingestion keys render in their own labeled section */
      it("shows the ingestion key's source tool and a revoke button without a permissions editor", () => {
        mockApiKeyList.mockReturnValue({
          data: [
            makeIngestionKey("key-ingest", "claude_code ingest", "claude_code"),
            makeRegularKey("key-ci", "CI Pipeline"),
          ],
          isLoading: false,
        });
        renderSection();

        // Both key names render.
        expect(screen.getByText("claude_code ingest")).toBeInTheDocument();
        expect(screen.getByText("CI Pipeline")).toBeInTheDocument();

        // Source tool is shown on the ingestion row.
        expect(screen.getByText("claude_code")).toBeInTheDocument();

        // Revoke is available for the ingestion key; edit (permissions) is not.
        expect(
          screen.getByRole("button", {
            name: "Revoke ingestion key claude_code ingest",
          }),
        ).toBeInTheDocument();
        expect(
          screen.queryByRole("button", {
            name: /Edit API key claude_code ingest/,
          }),
        ).not.toBeInTheDocument();

        // The regular key keeps its edit affordance.
        expect(
          screen.getByRole("button", { name: "Edit API key CI Pipeline" }),
        ).toBeInTheDocument();
      });
    });
  });

  describe("given the org has only regular API keys", () => {
    describe("when navigating to Settings > API Keys", () => {
      /** @scenario No ingestion section when no ingestion keys exist */
      it("does not render an 'Ingestion keys' heading", () => {
        mockApiKeyList.mockReturnValue({
          data: [makeRegularKey("key-ci", "CI Pipeline")],
          isLoading: false,
        });
        renderSection();

        expect(screen.getByText("CI Pipeline")).toBeInTheDocument();
        expect(
          screen.queryByRole("heading", { name: "Ingestion keys" }),
        ).not.toBeInTheDocument();
        // With no ingestion keys, the redundant "API keys" sub-heading is also
        // suppressed so the single-section layout is unchanged.
        expect(
          screen.queryByRole("heading", { name: "API keys" }),
        ).not.toBeInTheDocument();
      });
    });
  });
});
