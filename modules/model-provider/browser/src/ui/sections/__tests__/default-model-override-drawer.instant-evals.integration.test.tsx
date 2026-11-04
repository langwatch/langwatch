/**
 * @vitest-environment jsdom
 * The Instant Evals column offers decision models only, LangWatch Instant Preview first, and
 * only the ones the server says would run from the picked scopes, not the page's project (ADR-182).
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

const HOSTED = { value: "langwatch/instant-evals", label: "Instant Preview" };
const OPENAI_DECISIONS = {
  value: "openai/decisions:gpt-6-luna",
  label: "gpt-6-luna",
};

function instantEvalsOptions() {
  return within(instantEvalsListbox())
    .getAllByRole("option", { hidden: true })
    .filter((option) => option.dataset.testid !== "provider-model-selector-inherit");
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
  afterEach(() => cleanup());

  describe("given the server offers only LangWatch Instant Preview", () => {
    /** @scenario "The drawer offers only decision models for the Instant Evals column" */
    it("offers only LangWatch Instant Preview, never a chat model or an own model", () => {
      renderWithModelProviderHost(<DefaultModelOverrideDrawer editingId="cfg_1" />);

      const options = instantEvalsOptions();
      expect(options).toHaveLength(1);
      expect(options[0]).toHaveTextContent("Instant Preview");
      const listbox = instantEvalsListbox();
      expect(within(listbox).queryByText(/gpt-5\.5/)).not.toBeInTheDocument();
      expect(within(listbox).queryByText("Mercury Decide")).not.toBeInTheDocument();
    });

    it("reads LangWatch Instant Preview as the value when nothing is set", () => {
      renderWithModelProviderHost(<DefaultModelOverrideDrawer editingId="cfg_1" />);

      const trigger = within(screen.getByTestId("role-row-instant_evals")).getByRole("combobox");
      expect(trigger).toHaveTextContent("Instant Preview");
      expect(trigger).not.toHaveTextContent("Not configured");
    });
  });

  describe("given the server says the project's OpenAI decision model would run", () => {
    beforeEach(() =>
      mockListDecisionModels.mockReturnValue({
        data: [HOSTED, OPENAI_DECISIONS],
        isLoading: false,
      }),
    );

    /** @scenario "The drawer offers only the decision models that would run" */
    it("offers LangWatch Instant Preview first, then exactly the models the server offers", () => {
      renderWithModelProviderHost(<DefaultModelOverrideDrawer editingId="cfg_1" />);

      const labels = instantEvalsOptions().map((option) => option.textContent ?? "");
      expect(labels).toHaveLength(2);
      expect(labels[0]).toContain("Instant Preview");
      expect(labels[1]).toContain("gpt-6-luna");
      expect(
        within(instantEvalsListbox()).getByText("OpenAI Decisions API, on your OpenAI key."),
      ).toBeInTheDocument();
    });

    it("never offers a model whose provider key is missing, so a pick always runs", () => {
      renderWithModelProviderHost(<DefaultModelOverrideDrawer editingId="cfg_1" />);

      const listbox = instantEvalsListbox();
      expect(within(listbox).queryByText("Mercury Decide")).not.toBeInTheDocument();
      expect(within(listbox).queryByText(/key in Model Providers first/)).not.toBeInTheDocument();
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

    it("asks nothing and offers only LangWatch Instant Preview with no scope picked", () => {
      mockListDecisionModels.mockReturnValue({ data: undefined, isLoading: false });
      renderWithModelProviderHost(<DefaultModelOverrideDrawer />);

      const [input, options] = mockListDecisionModels.mock.lastCall ?? [];
      expect(input).toMatchObject({ scopes: [] });
      expect(options).toMatchObject({ enabled: false });
      const offered = instantEvalsOptions();
      expect(offered).toHaveLength(1);
      expect(offered[0]).toHaveTextContent("Instant Preview");
    });
  });
});
