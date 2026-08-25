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
 *  - Regular keys render above that section, under the page heading, with no
 *    heading of their own.
 *  - With no ingestion keys, no "Ingestion keys" heading appears (no change).
 *  - Each key row carries the anchor id deep links target.
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
    useUtils: () => ({
      apiKey: { list: { invalidate: vi.fn() } },
    }),
    apiKey: {
      list: { useQuery: () => mockApiKeyList() },
      myBindings: { useQuery: () => ({ data: [], isLoading: false }) },
      orgProjects: { useQuery: () => ({ data: [], isLoading: false }) },
      orgTeams: { useQuery: () => ({ data: [], isLoading: false }) },
      orgMembers: {
        useQuery: () => ({ data: [{ id: "u-1" }], isLoading: false }),
      },
      create: { useMutation: () => ({ mutate: vi.fn(), isLoading: false }) },
      update: { useMutation: () => ({ mutate: vi.fn(), isLoading: false }) },
      revoke: { useMutation: () => ({ mutate: vi.fn(), isLoading: false }) },
    },
    project: {
      regenerateApiKey: {
        useMutation: () => ({ mutate: vi.fn(), isLoading: false }),
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

// Built once via vi.hoisted and returned by reference on every call — a fresh
// literal per call busts the useMemo([organization]) inside useAvailableScopes
// and hangs the worker. See the sibling scope-filter test. `project.apiKey` is
// mutated per test (default null) to toggle the legacy project-key row.
const otpMocks = vi.hoisted(() => ({
  project: {
    id: "proj-1",
    name: "Project Alpha",
    apiKey: null as string | null,
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => {
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
      project: otpMocks.project,
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

function makeIngestionKey(
  id: string,
  name: string,
  sourceType: string,
  createdByDeviceLabel: string | null = "Rogerio's MacBook Pro",
) {
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
    createdByDeviceLabel,
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
    otpMocks.project.apiKey = null;
  });
  afterEach(() => cleanup());

  describe("given the org has an ingestion key and a regular key", () => {
    describe("when navigating to Settings > API Keys", () => {
      /** @scenario Ingestion keys render in their own labeled section */
      it("renders an 'Ingestion keys' heading", () => {
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
      });

      /** @scenario The page carries a single title and subtitle */
      it("gives the regular keys table no heading of its own, keeping the security warning", () => {
        mockApiKeyList.mockReturnValue({
          data: [
            makeIngestionKey("key-ingest", "claude_code ingest", "claude_code"),
            makeRegularKey("key-ci", "CI Pipeline"),
          ],
          isLoading: false,
        });
        renderSection();

        expect(
          screen.queryByRole("heading", { name: "API keys" }),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByText(/Keys scoped to a user or service/),
        ).not.toBeInTheDocument();
        expect(screen.getByText(/Do not share your API keys/)).toBeInTheDocument();
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
      });
    });
  });

  describe("given both an ingestion key and a regular key", () => {
    beforeEach(() => {
      mockApiKeyList.mockReturnValue({
        data: [
          makeIngestionKey("key-ingest", "claude_code ingest", "claude_code"),
          makeRegularKey("key-ci", "CI Pipeline"),
        ],
        isLoading: false,
      });
    });

    /** @scenario Ingestion keys render in their own labeled section */
    it("renders the regular keys above the Ingestion keys section", () => {
      renderSection();
      const regularKey = screen.getByText("CI Pipeline");
      const ingestHeading = screen.getByRole("heading", {
        name: "Ingestion keys",
      });
      // DOCUMENT_POSITION_FOLLOWING (4) means ingestHeading comes after the
      // regular key row in document order.
      expect(
        regularKey.compareDocumentPosition(ingestHeading) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    /** @scenario Deep link opens the page on a specific key */
    it("anchors every key row so a deep link can target it", () => {
      const { container } = renderSection();
      expect(container.querySelector("#api-key-key-ci")).toBeInTheDocument();
      expect(container.querySelector("#api-key-key-ingest")).toBeInTheDocument();
    });

    /** @scenario Ingestion keys render in their own labeled section */
    it("shows the ingestion key secret with the ik-lw- prefix", () => {
      renderSection();
      expect(screen.getByText(/^ik-lw-/)).toBeInTheDocument();
    });

    /** @scenario Ingestion key names the device session that minted it */
    it("shows the minting device label in the ingestion row", () => {
      renderSection();
      expect(screen.getByText("Rogerio's MacBook Pro")).toBeInTheDocument();
    });

    /** @scenario Ingestion key names the device session that minted it */
    it("falls back to 'Unknown device' when no device label was captured", () => {
      mockApiKeyList.mockReturnValue({
        data: [makeIngestionKey("key-x", "no-device ingest", "codex", null)],
        isLoading: false,
      });
      renderSection();
      expect(screen.getByText("Unknown device")).toBeInTheDocument();
    });
  });

  describe("given the legacy per-project service key exists", () => {
    beforeEach(() => {
      otpMocks.project.apiKey = "sk-proj-legacy-secret-abcd";
      mockApiKeyList.mockReturnValue({ data: [], isLoading: false });
    });

    /** @scenario Legacy project key row names its project */
    it("renders the project name on the legacy project key row", () => {
      renderSection();
      expect(screen.getByText("Project API Key")).toBeInTheDocument();
      // The scope cell names the project this fixed key belongs to.
      expect(screen.getByText("Project Alpha")).toBeInTheDocument();
    });
  });
});
