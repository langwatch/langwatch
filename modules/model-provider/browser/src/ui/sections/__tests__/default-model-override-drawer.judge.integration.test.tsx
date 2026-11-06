/**
 * @vitest-environment jsdom
 * The Judge row sits under Instant Evals, offers the chat models the Default row offers, and
 * reads the Default model while unset. Binds specs/model-providers/judge-default-model.feature.
 */
import type * as actualModule from "@langwatch/design-system/scope-chip-picker";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithModelProviderHost } from "../../../testing.tsx";
import { DefaultModelOverrideDrawer } from "../default-model-override-drawer.tsx";
import "@testing-library/jest-dom/vitest";

const mockGetDefaultModels = vi.fn();
const mockGetInheritedValues = vi.fn();
const mockListAllForProjectForFrontend = vi.fn();
const mockListDecisionModels = vi.fn();

// The drawer asks the judge router flag; off unless a case turns it on.
vi.mock("@langwatch/feature-flag-client", () => ({
  useFeatureFlag: () => ({ enabled: false, isLoading: false }),
}));

vi.mock("@langwatch/browser-host/drawer", () => ({
  useDrawer: () => ({
    closeDrawer: vi.fn(),
    openDrawer: vi.fn(),
    drawerOpen: () => false,
    canGoBack: false,
    goBack: vi.fn(),
    currentDrawer: undefined,
  }),
  useDrawerParams: () => ({}),
}));

vi.mock("@langwatch/design-system/scope-chip-picker", async () => {
  const actual = await vi.importActual<typeof actualModule>(
    "@langwatch/design-system/scope-chip-picker",
  );
  return { ...actual, ScopeChipPicker: () => <div data-testid="scope-chip-picker" /> };
});

vi.mock("../../../behavior/model-provider-api.ts", () => ({
  modelProviderApi: {
    useUtils: () => ({ modelProvider: { invalidate: vi.fn() } }),
    modelProvider: {
      getDefaultModelsForProject: { useQuery: () => mockGetDefaultModels() },
      getInheritedValuesForScopes: { useQuery: () => mockGetInheritedValues() },
      listAllForProjectForFrontend: { useQuery: () => mockListAllForProjectForFrontend() },
      listDecisionModelsForScopes: {
        useQuery: (input: unknown, options: unknown) => mockListDecisionModels(input, options),
      },
      saveDefaultModelsConfig: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
    },
  },
}));

const CONFIG_ROW = {
  id: "cfg_1",
  config: { DEFAULT: "openai/gpt-5.5" },
  createdAt: new Date("2026-05-15T12:00:00Z"),
  updatedAt: new Date("2026-05-15T12:00:00Z"),
  authorId: "user-1",
  scopes: [{ type: "ORGANIZATION" as const, id: "org-1", name: "Acme" }],
};

const PAYLOAD = {
  projectId: "proj-1",
  teamId: "team-1",
  organizationId: "org-1",
  organizationName: "Acme",
  effective: { DEFAULT: null, FAST: null, EMBEDDINGS: null },
  configs: [CONFIG_ROW],
  available: {
    organization: { id: "org-1", name: "Acme" },
    teams: [{ id: "team-1", name: "Platform" }],
    projects: [{ id: "proj-1", name: "Acme App", teamId: "team-1" }],
  },
  features: [
    {
      key: "scenarios.judge",
      role: "JUDGE",
      displayName: "Scenario judge",
      description: "Model that judges whether a scenario met its success criteria.",
    },
  ],
};

function roleRowLabels() {
  return screen.getAllByTestId(/^role-row-[a-z_]+-label$/).map((label) => label.textContent ?? "");
}

function optionValues(role: string) {
  const trigger = within(screen.getByTestId(`role-row-${role}`)).getByRole("combobox");
  const listbox = document.getElementById(trigger.getAttribute("aria-controls") ?? "");
  if (!listbox) throw new Error(`no listbox for the ${role} row`);
  return within(listbox)
    .getAllByRole("option", { hidden: true })
    .filter((option) => option.dataset.testid !== "provider-model-selector-inherit")
    .map((option) => option.textContent ?? "");
}

describe("<DefaultModelOverrideDrawer/> Judge row", () => {
  beforeEach(() => {
    mockGetDefaultModels.mockReturnValue({ data: PAYLOAD, isLoading: false });
    mockGetInheritedValues.mockReturnValue({
      data: { inherited: {}, referenceScope: null },
      isLoading: false,
    });
    mockListAllForProjectForFrontend.mockReturnValue({
      data: [{ provider: "openai", enabled: true, customModels: [], customEmbeddingsModels: [] }],
      isLoading: false,
      isError: false,
    });
    mockListDecisionModels.mockReturnValue({ data: [], isLoading: false });
  });
  afterEach(() => cleanup());

  /** @scenario "The drawer has an editable Judge row under Instant Evals" */
  it("puts Judge under Instant Evals with the Default row's chat models and the scenario judge", () => {
    renderWithModelProviderHost(<DefaultModelOverrideDrawer editingId="cfg_1" />);

    const labels = roleRowLabels();
    expect(labels.indexOf("Judge")).toBe(labels.indexOf("Instant Evals") + 1);
    expect(optionValues("judge")).toEqual(optionValues("default"));

    fireEvent.click(screen.getByTestId("role-row-judge-expand"));
    expect(
      within(screen.getByTestId("role-row-judge-features")).getByText("Scenario judge"),
    ).toBeInTheDocument();
  });

  /** @scenario "An unset Judge row inherits the Default model" */
  it("reads the Default model picked in this config while Judge is unset", () => {
    renderWithModelProviderHost(<DefaultModelOverrideDrawer editingId="cfg_1" />);

    const trigger = within(screen.getByTestId("role-row-judge")).getByRole("combobox");
    expect(trigger).toHaveTextContent("gpt-5.5");
    expect(trigger).not.toHaveTextContent("Not configured");
  });

  it("reads a Judge inherited from a wider scope over this config's Default", () => {
    mockGetInheritedValues.mockReturnValue({
      data: {
        inherited: {
          JUDGE: {
            model: "anthropic/claude-sonnet-4-6",
            source: "role_default",
            scope: "organization",
          },
        },
        referenceScope: null,
      },
      isLoading: false,
    });
    renderWithModelProviderHost(<DefaultModelOverrideDrawer editingId="cfg_1" />);

    const trigger = within(screen.getByTestId("role-row-judge")).getByRole("combobox");
    expect(trigger).toHaveTextContent("claude-sonnet-4-6");
  });
});
