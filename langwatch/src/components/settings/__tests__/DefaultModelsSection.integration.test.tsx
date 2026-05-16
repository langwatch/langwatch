/**
 * @vitest-environment jsdom
 *
 * Renders the Default Models section against the new ModelDefaultConfig
 * payload (B3.4 rework — CSS-cascade JSON configs, n:n scope
 * attachments). Verifies:
 *
 *  - Three effective role lines render at the top (Default / Fast /
 *    Embeddings), each with the resolved model + inheritance hint.
 *  - One row per config renders below, with all its scope chips and
 *    every key in its JSON payload shown.
 *  - Empty-state copy fires when no configs are attached.
 *
 * Mocks the tRPC query with a hand-crafted payload so the test stays
 * hermetic. The full UI (table + scope filter + drawer with all-roles-
 * at-once form) lives on the UI lane on top of this shim.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DefaultModelsSection } from "../DefaultModelsSection";

const mockGetDefaultModels = vi.fn();

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
    modelProvider: {
      getDefaultModelsForProject: {
        useQuery: () => mockGetDefaultModels(),
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
  // Two configs visible from this project's vantage. The first is an
  // org-scope policy with all three roles set. The second is a
  // multi-project override that pins traces.ai_search to claude.
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
      scopes: [
        { type: "ORGANIZATION", id: "org-1", name: "Acme" },
      ],
    },
    {
      id: "cfg_ai_search_override",
      config: {
        "traces.ai_search": "anthropic/claude-sonnet-4-6",
      },
      createdAt: new Date("2026-05-16T08:00:00Z"),
      updatedAt: new Date("2026-05-16T08:00:00Z"),
      authorId: "user-1",
      scopes: [
        { type: "PROJECT", id: "proj-1", name: "Acme App" },
      ],
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
  it("renders one config row per policy with its scope chips and config keys", () => {
    renderSection();
    const orgConfig = screen.getByTestId("config-row-cfg_acme_org");
    expect(orgConfig.textContent).toMatch(/Organization · Acme/);
    expect(orgConfig.textContent).toMatch(/openai\/gpt-5\.5/);
    expect(orgConfig.textContent).toMatch(/openai\/gpt-5\.4-mini/);

    const featureConfig = screen.getByTestId(
      "config-row-cfg_ai_search_override",
    );
    expect(featureConfig.textContent).toMatch(/Project · Acme App/);
    expect(featureConfig.textContent).toMatch(/traces\.ai_search/);
    expect(featureConfig.textContent).toMatch(/anthropic\/claude-sonnet-4-6/);
  });

  it("shows the empty-state copy when no configs exist", () => {
    mockGetDefaultModels.mockReturnValue({
      data: { ...FAKE_PAYLOAD, configs: [] },
      isLoading: false,
    });
    renderSection();
    expect(screen.getByText(/No configs yet/i)).toBeInTheDocument();
  });
});
