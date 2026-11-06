/**
 * @vitest-environment jsdom
 * The Instant Evals column lists decision models in one flat list, Evals Preview first; only the
 * ones the server says would run from the picked scopes can be picked (ADR-182).
 * Binds specs/model-providers/instant-evals-decision-model.feature.
 */
import type * as actualModule from "@langwatch/design-system/scope-chip-picker";
import { cleanup, screen, within } from "@testing-library/react";
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
  features: [],
};

const OWN_MODEL_FLAG = "release_instant_evals_own_decision_model";
const JUDGE_ROUTER_FLAG = "release_instant_evals_judge_router";
const HOSTED = { value: "langwatch/instant-evals", label: "Evals Preview" };
const OPENAI_DECISIONS = {
  value: "openai/decisions:gpt-6-luna",
  label: "OpenAI Decisions (gpt-6-luna)",
};
const AZURE_DECISIONS = {
  value: "azure/decisions:gpt-6-luna",
  label: "Azure OpenAI Decisions (gpt-6-luna)",
};

function instantEvalsOptions() {
  return within(instantEvalsListbox())
    .getAllByRole("option", { hidden: true })
    .filter((option) => option.dataset.testid !== "provider-model-selector-inherit");
}

function pickable(options: HTMLElement[]) {
  return options.filter((option) => option.getAttribute("aria-disabled") !== "true");
}

function optionTitled(title: string) {
  const option = instantEvalsOptions().find((row) => within(row).queryByText(title));
  if (!option) throw new Error(`no option titled ${title}`);
  return option;
}

function instantEvalsListbox() {
  const trigger = within(screen.getByTestId("role-row-instant_evals")).getByRole("combobox");
  const listbox = document.getElementById(trigger.getAttribute("aria-controls") ?? "");
  if (!listbox) throw new Error("no listbox for the Instant Evals row");
  return listbox;
}

describe("<DefaultModelOverrideDrawer/> Instant Evals column", () => {
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
    mockListDecisionModels.mockReturnValue({ data: [HOSTED], isLoading: false });
  });
  afterEach(() => {
    flagsOn.clear();
    cleanup();
  });

  describe("given own decision models are off for the organization", () => {
    /** @scenario "The drawer offers only decision models for the Instant Evals column" */
    it("offers only Evals Preview, never a chat model, an own model or an add-a-key hint", () => {
      renderWithModelProviderHost(<DefaultModelOverrideDrawer editingId="cfg_1" />);

      const options = pickable(instantEvalsOptions());
      expect(options).toHaveLength(1);
      expect(options[0]).toHaveTextContent("Evals Preview");
      const listbox = instantEvalsListbox();
      expect(within(listbox).queryByText(/gpt-5\.5/)).not.toBeInTheDocument();
      expect(within(listbox).queryByText("Inception Mercury Decide")).not.toBeInTheDocument();
      expect(within(listbox).queryByText(/key in Model Providers/)).not.toBeInTheDocument();
    });

    it("reads Evals Preview as the value when nothing is set", () => {
      renderWithModelProviderHost(<DefaultModelOverrideDrawer editingId="cfg_1" />);

      const trigger = within(screen.getByTestId("role-row-instant_evals")).getByRole("combobox");
      expect(trigger).toHaveTextContent("Evals Preview");
      expect(trigger).not.toHaveTextContent("Not configured");
    });
  });

  describe("given own decision models are on and the project's OpenAI decision model would run", () => {
    beforeEach(() => {
      flagsOn.add(OWN_MODEL_FLAG);
      mockListDecisionModels.mockReturnValue({
        data: [HOSTED, OPENAI_DECISIONS],
        isLoading: false,
      });
    });

    /** @scenario "The drawer offers only the decision models that would run" */
    it("lets only the models the server offers be picked, so every pick runs", () => {
      renderWithModelProviderHost(<DefaultModelOverrideDrawer editingId="cfg_1" />);

      const titles = pickable(instantEvalsOptions()).map((option) => option.textContent ?? "");
      expect(titles).toHaveLength(2);
      expect(titles[0]).toContain("Evals Preview");
      expect(titles[1]).toContain("OpenAI Decisions (gpt-6-luna)");
      expect(optionTitled("Inception Mercury Decide")).toHaveAttribute("aria-disabled", "true");
    });

    /** @scenario "The decision model picker is one flat list with LangWatch's models first" */
    it("lists Evals Preview first and checked, with no heading or Default row, every row described", () => {
      flagsOn.add(JUDGE_ROUTER_FLAG);
      renderWithModelProviderHost(<DefaultModelOverrideDrawer editingId="cfg_1" />);

      const listbox = instantEvalsListbox();
      expect(listbox.querySelector('[data-part="item-group-label"]')).toBeNull();
      expect(
        within(listbox).queryByTestId("provider-model-selector-inherit"),
      ).not.toBeInTheDocument();
      const options = instantEvalsOptions();
      expect(options[0]).toHaveTextContent("Evals Preview");
      expect(options[0]).toHaveAttribute("aria-selected", "true");
      expect(options[1]).toHaveTextContent("Scenario Judge Preview");
      expect(options[2]).toHaveTextContent("Search Preview");
      expect(options[1]).toHaveAttribute("aria-disabled", "true");
      expect(options[1]).toHaveTextContent("Coming soon");
      expect(options[0]).toHaveTextContent("Optimized for evals, routed");
      for (const option of options) {
        expect(option.querySelector("svg, img")).not.toBeNull();
        expect(option.querySelector('[data-testid="model-option-subtitle"]')).not.toBeNull();
      }
    });

    it("lists no coming-soon preview with the judge router flag off", () => {
      renderWithModelProviderHost(<DefaultModelOverrideDrawer editingId="cfg_1" />);

      const listbox = instantEvalsListbox();
      expect(within(listbox).getByText("Evals Preview")).toBeInTheDocument();
      expect(within(listbox).queryByText("Scenario Judge Preview")).not.toBeInTheDocument();
      expect(within(listbox).queryByText("Search Preview")).not.toBeInTheDocument();
    });

    /** @scenario "A decision model whose provider has no key says how to enable it" */
    it("tells how to enable a model whose provider has no key, and keeps it unpickable", () => {
      renderWithModelProviderHost(<DefaultModelOverrideDrawer editingId="cfg_1" />);

      const inception = optionTitled("Inception Mercury Decide");
      expect(inception).toHaveTextContent("Add an Inception key in Model Providers to use it.");
      expect(inception).toHaveAttribute("aria-disabled", "true");
      expect(optionTitled("OpenAI Decisions (gpt-6-luna)")).toHaveTextContent(
        "OpenAI's Decisions API, on your OpenAI key.",
      );
    });
  });

  describe("given OpenAI and Azure both offer gpt-6-luna", () => {
    beforeEach(() => {
      flagsOn.add(OWN_MODEL_FLAG);
      mockListDecisionModels.mockReturnValue({
        data: [HOSTED, OPENAI_DECISIONS, AZURE_DECISIONS],
        isLoading: false,
      });
    });

    /** @scenario "A model two providers offer is told apart by its provider" */
    it("lists the two as rows titled by their provider", () => {
      renderWithModelProviderHost(<DefaultModelOverrideDrawer editingId="cfg_1" />);

      const titles = pickable(instantEvalsOptions()).map((option) => option.textContent ?? "");
      expect(titles.some((title) => title.includes("OpenAI Decisions (gpt-6-luna)"))).toBe(true);
      expect(titles.some((title) => title.includes("Azure OpenAI Decisions (gpt-6-luna)"))).toBe(
        true,
      );
    });
  });

  describe("given a config row scoped to the organization", () => {
    /** @scenario "The drawer asks about the picked scopes, not the page's project" */
    it("asks for the decision models of the organization scope, not the page's project", () => {
      renderWithModelProviderHost(<DefaultModelOverrideDrawer editingId="cfg_1" />);

      const [input, options] = mockListDecisionModels.mock.lastCall ?? [];
      expect(input).toEqual({
        projectId: expect.any(String),
        scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
      });
      expect(options).toMatchObject({ enabled: true });
    });

    it("asks nothing and offers only Evals Preview with no scope picked", () => {
      mockListDecisionModels.mockReturnValue({ data: undefined, isLoading: false });
      renderWithModelProviderHost(<DefaultModelOverrideDrawer />);

      const [input, options] = mockListDecisionModels.mock.lastCall ?? [];
      expect(input).toMatchObject({ scopes: [] });
      expect(options).toMatchObject({ enabled: false });
      const offered = pickable(instantEvalsOptions());
      expect(offered).toHaveLength(1);
      expect(offered[0]).toHaveTextContent("Evals Preview");
    });
  });
});
