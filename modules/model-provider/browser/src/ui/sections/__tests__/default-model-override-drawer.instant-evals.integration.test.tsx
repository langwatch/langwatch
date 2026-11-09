/**
 * @vitest-environment jsdom
 * The Instant Evals column lists decision models in one flat list, Evals Preview first; only the
 * ones the server says would run from the picked scopes can be picked (ADR-182).
 * Binds specs/model-providers/instant-evals-decision-model.feature.
 */
import type * as actualModule from "@langwatch/design-system/scope-chip-picker";
import { NOT_TARGETED } from "@langwatch/feature-flag-contract";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithModelProviderHost } from "../../../testing.tsx";
import { DefaultModelOverrideDrawer } from "../default-model-override-drawer.tsx";
import "@testing-library/jest-dom/vitest";

const mockGetDefaultModels = vi.fn();
const mockGetInheritedValues = vi.fn();
const mockListAllForProjectForFrontend = vi.fn();
const mockListDecisionModels = vi.fn();
const mockSave = vi.fn();

// The drawer asks the judge router and own decision model flags; off unless a case turns one on.
const flagsOn = new Set<string>();
const flagReads: { flag: string; target: unknown }[] = [];
vi.mock("@langwatch/feature-flag-client", () => ({
  useFeatureFlag: (flag: { name: string }, target: unknown) => {
    flagReads.push({ flag: flag.name, target });
    return { enabled: flagsOn.has(flag.name), isLoading: false };
  },
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
        useMutation: () => ({ mutateAsync: mockSave, isPending: false }),
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
  label: "OpenAI Decisions",
};
const AZURE_DECISIONS = {
  value: "azure/decisions:gpt-6-luna",
  label: "Azure OpenAI Decisions",
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
      expect(titles[1]).toContain("Decisions API");
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

    it("asks the own decision model flag of the organization, never the project", () => {
      renderWithModelProviderHost(<DefaultModelOverrideDrawer editingId="cfg_1" />);

      const read = flagReads.find((entry) => entry.flag === OWN_MODEL_FLAG);
      expect(read?.target).toMatchObject({ projectId: NOT_TARGETED });
    });

    /** @scenario "A decision model whose provider has no key says how to enable it" */
    it("tells how to enable a model whose provider has no key, and keeps it unpickable", () => {
      renderWithModelProviderHost(<DefaultModelOverrideDrawer editingId="cfg_1" />);

      const inception = optionTitled("Inception Mercury Decide");
      expect(inception).toHaveTextContent("Add an Inception key in Model Providers to use it.");
      expect(inception).toHaveAttribute("aria-disabled", "true");
      expect(optionTitled("Decisions API")).toHaveTextContent(
        "OpenAI's Decisions API, on your OpenAI key.",
      );
    });
  });

  describe("given a config row that sets nothing", () => {
    const emptyRow = { ...CONFIG_ROW, config: {} };
    beforeEach(() => {
      mockGetDefaultModels.mockReturnValue({
        data: { ...PAYLOAD, configs: [emptyRow] },
        isLoading: false,
      });
      mockSave.mockResolvedValue({ id: "cfg_1" });
    });

    /** @scenario "Picking Evals Preview stores it, so a wider scope cannot take the column over" */
    it("stores Evals Preview when it is picked, as the config's only value", async () => {
      renderWithModelProviderHost(<DefaultModelOverrideDrawer editingId="cfg_1" />);

      const trigger = within(screen.getByTestId("role-row-instant_evals")).getByRole("combobox");
      await userEvent.setup().click(trigger);
      await userEvent.setup().click(optionTitled("Evals Preview"));
      fireEvent.click(screen.getByTestId("config-save"));

      await vi.waitFor(() => expect(mockSave).toHaveBeenCalled());
      const saved = mockSave.mock.calls[0]?.[0] as { config: Record<string, string> };
      expect(saved.config).toEqual({ INSTANT_EVALS: HOSTED.value });
    });
  });

  describe("given a config row that pins Evals Preview", () => {
    beforeEach(() => {
      mockGetDefaultModels.mockReturnValue({
        data: { ...PAYLOAD, configs: [{ ...CONFIG_ROW, config: { INSTANT_EVALS: HOSTED.value } }] },
        isLoading: false,
      });
    });

    it("lists the inherit entry so the pin can be cleared", () => {
      renderWithModelProviderHost(<DefaultModelOverrideDrawer editingId="cfg_1" />);

      expect(
        within(instantEvalsListbox()).getByTestId("provider-model-selector-inherit"),
      ).toBeInTheDocument();
    });
  });

  describe("given the Instant Evals feature row is open and nothing is set", () => {
    beforeEach(() => {
      mockGetDefaultModels.mockReturnValue({
        data: {
          ...PAYLOAD,
          features: [
            {
              key: "instant_eval.judge",
              role: "INSTANT_EVALS",
              displayName: "Instant Evals",
              description: "The decision model Instant Evals and their judged columns run on.",
            },
          ],
        },
        isLoading: false,
      });
    });

    /** @scenario "The Instant Evals feature picker lists Evals Preview once, with no Default row" */
    it("shows Evals Preview checked, with no Default row beside it", () => {
      renderWithModelProviderHost(<DefaultModelOverrideDrawer editingId="cfg_1" />);
      fireEvent.click(screen.getByTestId("role-row-instant_evals-expand"));

      const trigger = within(screen.getByTestId("feature-row-instant_eval.judge")).getByRole(
        "combobox",
      );
      expect(trigger).toHaveTextContent("Evals Preview");
      const listbox = document.getElementById(trigger.getAttribute("aria-controls") ?? "");
      if (!listbox) throw new Error("no listbox for the Instant Evals feature row");
      expect(
        within(listbox).queryByTestId("provider-model-selector-inherit"),
      ).not.toBeInTheDocument();
      const hosted = within(listbox)
        .getAllByRole("option", { hidden: true })
        .filter((option) => within(option).queryByText("Evals Preview"));
      expect(hosted).toHaveLength(1);
      expect(hosted[0]).toHaveAttribute("aria-selected", "true");
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
    it("lists the two as Decisions API rows, told apart by their provider icon", () => {
      renderWithModelProviderHost(<DefaultModelOverrideDrawer editingId="cfg_1" />);

      const rows = pickable(instantEvalsOptions()).filter((option) =>
        [OPENAI_DECISIONS.value, AZURE_DECISIONS.value].includes(option.dataset.value ?? ""),
      );
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row).toHaveTextContent("Decisions API");
        expect(row.querySelector("svg, img")).not.toBeNull();
      }
      expect(rows[0]?.querySelector("svg, img")?.outerHTML).not.toBe(
        rows[1]?.querySelector("svg, img")?.outerHTML,
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
