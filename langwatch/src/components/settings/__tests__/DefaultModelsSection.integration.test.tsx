/**
 * @vitest-environment jsdom
 *
 * Renders the line-based DefaultModelsSection and verifies the three role
 * lines + the per-feature expansion under Default and Fast + the absence
 * of expansion under Embeddings. Mocks the tRPC query layer with a fixed
 * `getDefaultModelsForProject` payload so the test is hermetic.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DefaultModelsSection } from "../DefaultModelsSection";

const mockGetDefaultModels = vi.fn();
const mockSetRole = vi.fn();
const mockSetFeature = vi.fn();
const mockInvalidate = vi.fn();

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
        useMutation: () => ({ mutateAsync: mockSetRole, isPending: false }),
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
  roles: [
    {
      role: "DEFAULT",
      effective: {
        model: "openai/gpt-5.5",
        source: "role_default",
        scope: "organization",
      },
      perScope: {
        organization: "openai/gpt-5.5",
        team: null,
        project: null,
      },
      features: [
        {
          key: "prompt.create_default",
          displayName: "New prompt model",
          description: "Model written into a freshly created prompt.",
          effective: {
            model: "openai/gpt-5.5",
            source: "role_default",
            scope: "organization",
          },
          perScope: { organization: null, team: null, project: null },
        },
      ],
    },
    {
      role: "FAST",
      effective: {
        model: "openai/gpt-5.4-mini",
        source: "role_default",
        scope: "organization",
      },
      perScope: {
        organization: "openai/gpt-5.4-mini",
        team: null,
        project: null,
      },
      features: [
        {
          key: "traces.ai_search",
          displayName: "AI search",
          description: "Natural-language search over your traces.",
          effective: {
            model: "openai/gpt-5.4-mini",
            source: "role_default",
            scope: "organization",
          },
          perScope: { organization: null, team: null, project: null },
        },
        {
          key: "studio.autocomplete",
          displayName: "Code editor autocomplete",
          description: "Inline completion in the prompt editor.",
          effective: {
            model: "openai/gpt-5.4-mini",
            source: "role_default",
            scope: "organization",
          },
          perScope: { organization: null, team: null, project: null },
        },
      ],
    },
    {
      role: "EMBEDDINGS",
      effective: {
        model: "openai/text-embedding-3-small",
        source: "role_default",
        scope: "organization",
      },
      perScope: {
        organization: "openai/text-embedding-3-small",
        team: null,
        project: null,
      },
      features: [],
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
    mockSetRole.mockReset();
    mockSetFeature.mockReset();
    mockInvalidate.mockReset();
  });
  afterEach(() => cleanup());

  /** @scenario The Default Models section opens with three role lines */
  it("renders one card per role: Default, Fast, Embeddings", () => {
    renderSection();
    expect(screen.getByTestId("role-line-default")).toBeInTheDocument();
    expect(screen.getByTestId("role-line-fast")).toBeInTheDocument();
    expect(screen.getByTestId("role-line-embeddings")).toBeInTheDocument();
  });

  /** @scenario Each role line shows the effective model and where it comes from */
  it("shows the effective model and the inheritance hint on each role", () => {
    renderSection();
    const defaultLine = screen.getByTestId("role-line-default");
    expect(defaultLine.textContent).toMatch(/openai\/gpt-5\.5/);
    expect(defaultLine.textContent).toMatch(/inherited from organization/);

    const fastLine = screen.getByTestId("role-line-fast");
    expect(fastLine.textContent).toMatch(/openai\/gpt-5\.4-mini/);

    const embeddingsLine = screen.getByTestId("role-line-embeddings");
    expect(embeddingsLine.textContent).toMatch(
      /openai\/text-embedding-3-small/,
    );
  });

  /** @scenario Expanding the Fast role shows every feature that consumes it */
  it("reveals all FAST-role features under the expanded Fast line", () => {
    renderSection();
    // Initially collapsed: no feature rows visible.
    expect(
      screen.queryByTestId("feature-row-traces.ai_search"),
    ).not.toBeInTheDocument();
    // Click the chevron to expand.
    fireEvent.click(screen.getByTestId("role-line-fast-expand"));
    expect(
      screen.getByTestId("feature-row-traces.ai_search"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("feature-row-studio.autocomplete"),
    ).toBeInTheDocument();
  });

  /** @scenario Embeddings never expands because it has no sub-features */
  it("does not render an expand control on the Embeddings line", () => {
    renderSection();
    expect(
      screen.queryByTestId("role-line-embeddings-expand"),
    ).not.toBeInTheDocument();
  });
});
