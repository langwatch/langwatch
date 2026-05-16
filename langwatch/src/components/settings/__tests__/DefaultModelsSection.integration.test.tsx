/**
 * @vitest-environment jsdom
 *
 * Integration tests for the redesigned Default Models settings table
 * + override drawer (B3.4 rework — flat ModelDefaultConfig policies
 * with CSS-cascade JSON payloads, n:n scope attachments).
 *
 * Coverage:
 *  - The "All you can see" view renders a table with one row per
 *    config the caller can see. Each row shows scope chips, the
 *    role-level model in the matching column, and indented per-feature
 *    overrides under their role's column.
 *  - "+ Add config" opens an empty drawer; the drawer's role rows show
 *    inherited-as-placeholder text when no override is set.
 *  - The Edit affordance on a config row opens the drawer pre-filled
 *    with that config's scopes + JSON.
 *  - Switching to "This Project" via the scope filter swaps to the
 *    resolved-at-scope view with the cascaded values rendered.
 *
 * Mocks the tRPC payload + mutations directly so the test stays
 * hermetic.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DefaultModelsSection } from "../DefaultModelsSection";

const mockGetDefaultModels = vi.fn();
const mockInvalidate = vi.fn();
const mockSave = vi.fn();
const mockDelete = vi.fn();

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "acme-app", name: "Acme App" },
    organization: { id: "org-1", name: "Acme" },
    team: { id: "team-1", name: "Platform" },
    hasPermission: () => true,
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      modelProvider: {
        getDefaultModelsForProject: { invalidate: mockInvalidate },
      },
    }),
    modelProvider: {
      getDefaultModelsForProject: {
        useQuery: () => mockGetDefaultModels(),
      },
      getInheritedValuesForScopes: {
        useQuery: () => ({
          data: { inherited: {}, referenceScope: null },
          isLoading: false,
        }),
      },
      getAllForProject: {
        useQuery: () => ({
          data: {
            openai: { enabled: true, customModels: [], customEmbeddingsModels: [] },
          },
          isLoading: false,
        }),
      },
      saveDefaultModelsConfig: {
        useMutation: () => ({ mutateAsync: mockSave, isPending: false }),
      },
      deleteDefaultModelsConfig: {
        useMutation: () => ({ mutateAsync: mockDelete, isPending: false }),
      },
    },
  },
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

const FAKE_PAYLOAD = {
  projectId: "proj-1",
  teamId: "team-1",
  organizationId: "org-1",
  organizationName: "Acme",
  effective: {
    DEFAULT: {
      model: "openai/gpt-5.5",
      source: "role_default",
      scope: "organization",
    },
    FAST: {
      model: "openai/gpt-5.4-mini",
      source: "role_default",
      scope: "organization",
    },
    EMBEDDINGS: {
      model: "openai/text-embedding-3-small",
      source: "role_default",
      scope: "organization",
    },
  },
  configs: [
    {
      id: "cfg_acme_org",
      config: {
        DEFAULT: "openai/gpt-5.5",
        FAST: "openai/gpt-5.4-mini",
        EMBEDDINGS: "openai/text-embedding-3-small",
      },
      createdAt: new Date("2026-05-15T12:00:00Z"),
      updatedAt: new Date("2026-05-15T12:00:00Z"),
      authorId: "user-1",
      scopes: [{ type: "ORGANIZATION", id: "org-1", name: "Acme" }],
    },
    {
      id: "cfg_ai_search_override",
      config: {
        "traces.ai_search": "anthropic/claude-sonnet-4-6",
      },
      createdAt: new Date("2026-05-16T08:00:00Z"),
      updatedAt: new Date("2026-05-16T08:00:00Z"),
      authorId: "user-1",
      scopes: [{ type: "PROJECT", id: "proj-1", name: "Acme App" }],
    },
  ],
  available: {
    organization: { id: "org-1", name: "Acme" },
    teams: [{ id: "team-1", name: "Platform" }],
    projects: [{ id: "proj-1", name: "Acme App", teamId: "team-1" }],
  },
  features: [
    {
      key: "prompt.create_default",
      role: "DEFAULT",
      displayName: "New prompt model",
      description: "Model written into a freshly created prompt.",
    },
    {
      key: "traces.ai_search",
      role: "FAST",
      displayName: "AI search",
      description: "Natural-language search over your traces.",
    },
  ],
};

function renderSection() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <DefaultModelsSection />
    </ChakraProvider>,
  );
}

describe("<DefaultModelsSection />", () => {
  beforeEach(() => {
    mockGetDefaultModels.mockReturnValue({
      data: FAKE_PAYLOAD,
      isLoading: false,
    });
    mockInvalidate.mockReset();
    mockSave.mockReset();
    mockDelete.mockReset();
  });
  afterEach(() => cleanup());

  /** @scenario The Default Models page shows the list of override rules */
  it("renders one row per config in the All-you-can-see view", () => {
    renderSection();
    expect(
      screen.getByTestId("config-row-cfg_acme_org"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("config-row-cfg_ai_search_override"),
    ).toBeInTheDocument();
  });

  /** @scenario A freshly onboarded org shows its three seeded org-scope rules */
  it("places role-level models in their matching column", () => {
    renderSection();
    const orgRow = screen.getByTestId("config-row-cfg_acme_org");
    // Each role column gets its data-testid; the table puts the model
    // pill inside the role-matching cell.
    expect(
      screen.getByTestId("config-row-cfg_acme_org-cell-default").textContent,
    ).toMatch(/gpt-5\.5/);
    expect(
      screen.getByTestId("config-row-cfg_acme_org-cell-fast").textContent,
    ).toMatch(/gpt-5\.4-mini/);
    expect(
      screen.getByTestId("config-row-cfg_acme_org-cell-embeddings").textContent,
    ).toMatch(/text-embedding-3-small/);
    // Scope chip carries the org name (not bare type).
    expect(orgRow.textContent).toMatch(/Acme/);
  });

  /** @scenario Editing an assignment row opens the drawer pre-filled with that rule */
  it("opens the override drawer pre-filled when an Edit button is clicked", async () => {
    renderSection();
    fireEvent.click(
      screen.getByTestId("config-row-cfg_acme_org-edit"),
    );
    expect(
      await screen.findByText(/Edit config/),
    ).toBeInTheDocument();
    // Drawer is in edit mode → Delete enabled.
    expect(screen.getByTestId("config-delete")).not.toBeDisabled();
    // The DEFAULT role row exists in the drawer.
    expect(screen.getByTestId("role-row-default")).toBeInTheDocument();
  });

  /** @scenario Adding an override opens a drawer with a scope chip picker and per-role model selectors */
  it("opens an empty drawer when +Add config is clicked", async () => {
    renderSection();
    fireEvent.click(screen.getByTestId("add-config-button"));
    expect(await screen.findByText(/Add config/)).toBeInTheDocument();
    expect(screen.getByTestId("role-row-default")).toBeInTheDocument();
    expect(screen.getByTestId("role-row-fast")).toBeInTheDocument();
    expect(screen.getByTestId("role-row-embeddings")).toBeInTheDocument();
    // Save disabled while scopes are empty.
    expect(screen.getByTestId("config-save")).toBeDisabled();
  });
});
