/**
 * @vitest-environment jsdom
 * The Judge row sits under Instant Evals, offers the chat models the Default row offers, and
 * reads the Default model while unset. Binds specs/model-providers/judge-default-model.feature.
 */
import type * as actualModule from "@langwatch/design-system/scope-chip-picker";
import {
  DECISION_MODELS,
  isLatestAlias,
  isOwnDecisionModelId,
  LANGWATCH_DECISION_MODEL_ID,
} from "@langwatch/model-provider-contract";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithModelProviderHost } from "../../../testing.tsx";
import { DefaultModelOverrideDrawer } from "../default-model-override-drawer.tsx";
import "@testing-library/jest-dom/vitest";

const mockGetDefaultModels = vi.fn();
const mockGetInheritedValues = vi.fn();
const mockListAllForProjectForFrontend = vi.fn();
const mockListDecisionModels = vi.fn();

// The drawer asks the judge router and own decision model flags; off unless a case turns one on.
const flagsOn = new Set<string>();
vi.mock("@langwatch/feature-flag-client", () => ({
  useFeatureFlag: (flag: { name: string }) => ({
    enabled: flagsOn.has(flag.name),
    isLoading: false,
  }),
}));
const JUDGE_ROUTER_FLAG = "release_instant_evals_judge_router";
const OWN_DECISION_MODEL_FLAG = "release_instant_evals_own_decision_model";
const OWN_DECISION_MODEL_IDS = DECISION_MODELS.filter((entry) =>
  isOwnDecisionModelId(entry.id),
).map((entry) => entry.id);

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

function listboxOf(role: string) {
  const trigger = within(screen.getByTestId(`role-row-${role}`)).getByRole("combobox");
  const listbox = document.getElementById(trigger.getAttribute("aria-controls") ?? "");
  if (!listbox) throw new Error(`no listbox for the ${role} row`);
  return listbox;
}

function judgeListbox() {
  return listboxOf("judge");
}

function optionValues(role: string) {
  return within(listboxOf(role))
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
  afterEach(() => {
    flagsOn.clear();
    cleanup();
  });

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

  /** @scenario "The Judge picker offers only models that can judge a scenario" */
  it("lists no decision model, the inherit row first, then plain LLM rows", () => {
    flagsOn.add(JUDGE_ROUTER_FLAG);
    flagsOn.add(OWN_DECISION_MODEL_FLAG);
    mockListDecisionModels.mockReturnValue({
      data: [
        { value: LANGWATCH_DECISION_MODEL_ID, label: "Evals Preview" },
        { value: "openai/decisions:gpt-6-luna", label: "OpenAI Decisions" },
      ],
      isLoading: false,
    });
    renderWithModelProviderHost(<DefaultModelOverrideDrawer editingId="cfg_1" />);

    const listbox = judgeListbox();
    expect(listbox.querySelector('[data-part="item-group-label"]')).toBeNull();
    const rows = within(listbox).getAllByRole("option", { hidden: true });
    expect(rows[0]?.dataset.testid).toBe("provider-model-selector-inherit");
    const values = rows.map((row) => row.dataset.value ?? "");
    expect(values.some((value) => value.startsWith("langwatch/"))).toBe(false);
    expect(values.some((value) => OWN_DECISION_MODEL_IDS.includes(value))).toBe(false);

    const llmRows = rows
      .slice(1)
      // A "Latest" alias keeps the model it resolves to as its line; a model id has none.
      .filter((row) => !isLatestAlias(row.dataset.value ?? ""));
    expect(llmRows.length).toBeGreaterThan(0);
    for (const row of llmRows) {
      expect(row.querySelector("svg, img")).not.toBeNull();
      expect(row.querySelector('[data-testid="model-option-subtitle"]')).toBeNull();
      expect(row).not.toHaveAttribute("aria-disabled", "true");
    }
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
