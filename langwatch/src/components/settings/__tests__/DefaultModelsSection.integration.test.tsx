/**
 * @vitest-environment jsdom
 *
 * Renders the Default Models section against the new flat
 * `assignments[]` payload (B3 redesign — RBAC-style policy list, no
 * one-field-per-scope). Verifies:
 *
 *  - Three effective role lines render at the top (Default / Fast /
 *    Embeddings), each with the resolved model + inheritance hint.
 *  - One row per assignment renders below, scopes shown as chips on
 *    the same row (a single rule spanning multiple scopes is ONE
 *    visual row, not N).
 *  - The "+ Add override" CTA opens the override drawer.
 *  - Editing an assignment row pre-fills the drawer with that rule's
 *    scopes, role/feature, and model.
 *
 * Mocks the tRPC query + mutation layer with a hand-crafted payload so
 * the test stays hermetic. The DefaultModelOverrideDrawer mounts a
 * full-fledged Chakra Drawer; we only assert on the radio + role
 * buttons + chip summary text rather than driving the underlying chip
 * `Select`, which is portaled and harder to test in jsdom.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DefaultModelsSection } from "../DefaultModelsSection";

const mockGetDefaultModels = vi.fn();
const mockInvalidate = vi.fn();
const mockSetRole = vi.fn();
const mockSetFeature = vi.fn();

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
      setRoleAssignmentForScope: {
        useMutation: () => ({
          mutateAsync: mockSetRole,
          isPending: false,
        }),
      },
      setFeatureOverrideForScope: {
        useMutation: () => ({
          mutateAsync: mockSetFeature,
          isPending: false,
        }),
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
  // One assignment can carry multiple scopes — the rule below applies
  // gpt-5.5 across the org PLUS Team Platform PLUS Project web-app.
  assignments: [
    {
      id: "DEFAULT::::openai/gpt-5.5",
      role: "DEFAULT",
      featureKey: null,
      model: "openai/gpt-5.5",
      scopes: [
        { type: "ORGANIZATION", id: "org-1", name: "Acme" },
        { type: "TEAM", id: "team-1", name: "Platform" },
        { type: "PROJECT", id: "proj-1", name: "Acme App" },
      ],
    },
    {
      id: "FAST::::openai/gpt-5.4-mini",
      role: "FAST",
      featureKey: null,
      model: "openai/gpt-5.4-mini",
      scopes: [{ type: "ORGANIZATION", id: "org-1", name: "Acme" }],
    },
    {
      id: "FAST::traces.ai_search::anthropic/claude-sonnet-4-6",
      role: "FAST",
      featureKey: "traces.ai_search",
      model: "anthropic/claude-sonnet-4-6",
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
    {
      key: "studio.autocomplete",
      role: "FAST",
      displayName: "Code editor autocomplete",
      description: "Inline completion in the prompt editor.",
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
    mockSetRole.mockReset();
    mockSetFeature.mockReset();
  });
  afterEach(() => cleanup());

  /** @scenario The Default Models section opens with the three effective lines */
  it("renders three effective role lines at the top", () => {
    renderSection();
    expect(screen.getByTestId("role-line-default")).toBeInTheDocument();
    expect(screen.getByTestId("role-line-fast")).toBeInTheDocument();
    expect(screen.getByTestId("role-line-embeddings")).toBeInTheDocument();
  });

  /** @scenario Each role line shows the effective model and where it comes from */
  it("shows the effective model and inheritance hint on each role", () => {
    renderSection();
    const defaultLine = screen.getByTestId("role-line-default");
    expect(defaultLine.textContent).toMatch(/openai\/gpt-5\.5/);
    expect(defaultLine.textContent).toMatch(/from organization/);

    const fastLine = screen.getByTestId("role-line-fast");
    expect(fastLine.textContent).toMatch(/openai\/gpt-5\.4-mini/);

    const embeddingsLine = screen.getByTestId("role-line-embeddings");
    expect(embeddingsLine.textContent).toMatch(
      /openai\/text-embedding-3-small/,
    );
  });

  /** @scenario The overrides list shows one row per assignment, each row with its scope chips */
  it("renders one assignment row per group with all its scope chips", () => {
    renderSection();
    const multiScopeRow = screen.getByTestId(
      "assignment-row-DEFAULT::::openai/gpt-5.5",
    );
    // Multi-scope assignment renders ONCE with three scope chips on
    // the same row — not three separate rows.
    expect(multiScopeRow.textContent).toMatch(/openai\/gpt-5\.5/);
    expect(multiScopeRow.textContent).toMatch(/Organization · Acme/);
    expect(multiScopeRow.textContent).toMatch(/Team · Platform/);
    expect(multiScopeRow.textContent).toMatch(/Project · Acme App/);

    // Per-feature override row labels the feature, not just the role.
    const featureRow = screen.getByTestId(
      "assignment-row-FAST::traces.ai_search::anthropic/claude-sonnet-4-6",
    );
    expect(featureRow.textContent).toMatch(/Fast · AI search/);
    expect(featureRow.textContent).toMatch(/anthropic\/claude-sonnet-4-6/);
  });

  /** @scenario Adding an override opens a drawer with a scope chip picker and per-role model selectors */
  it("opens the drawer with an empty form when Add override is clicked", async () => {
    renderSection();
    // Drawer.Root unmounts its content while `open=false`, so the title
    // text isn't present yet.
    expect(screen.queryByText(/Add override/i, { selector: "h2,h3,header *" }))
      .toBeNull;

    fireEvent.click(screen.getByTestId("add-override-button"));

    // Verify the drawer body landed in the document via its scope-picker
    // label + the per-role buttons + the model selector trigger.
    expect(
      await screen.findByText(/Scope\(s\) this override applies to/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId("override-mode-role")).toBeInTheDocument();
    expect(screen.getByTestId("override-mode-feature")).toBeInTheDocument();
    expect(screen.getByTestId("override-role-default")).toBeInTheDocument();
    expect(screen.getByTestId("override-role-fast")).toBeInTheDocument();
    expect(screen.getByTestId("override-role-embeddings")).toBeInTheDocument();
    // Save disabled (no chips, no model picked yet).
    expect(screen.getByTestId("override-save")).toBeDisabled();
  });

  /** @scenario Editing an assignment row opens the drawer pre-filled with that rule */
  it("opens the drawer pre-filled when an assignment row's Edit is clicked", async () => {
    renderSection();
    fireEvent.click(
      screen.getByTestId(
        "assignment-row-FAST::traces.ai_search::anthropic/claude-sonnet-4-6-edit",
      ),
    );
    // Editing this feature-keyed row puts the drawer in "feature" mode,
    // so the feature-pick row for "traces.ai_search" must be visible.
    expect(
      await screen.findByTestId("override-feature-traces.ai_search"),
    ).toBeInTheDocument();
    // Delete CTA is enabled in edit mode.
    expect(screen.getByTestId("override-delete")).not.toBeDisabled();
  });

  it("shows the empty-state copy when no assignments exist", () => {
    mockGetDefaultModels.mockReturnValue({
      data: { ...FAKE_PAYLOAD, assignments: [] },
      isLoading: false,
    });
    renderSection();
    expect(screen.getByText(/No overrides yet/i)).toBeInTheDocument();
  });
});
