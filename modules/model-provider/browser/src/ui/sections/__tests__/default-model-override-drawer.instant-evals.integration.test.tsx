/**
 * @vitest-environment jsdom
 * The Instant Evals column offers decision models only, LangWatch Instant Preview first;
 * own decision models need the organization's flag (ADR-182).
 * Binds specs/model-providers/instant-evals-decision-model.feature.
 */
import type * as actualModule from "@langwatch/design-system/scope-chip-picker";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeModelProviderHost, renderWithModelProviderHost } from "../../../testing.tsx";
import { DefaultModelOverrideDrawer } from "../default-model-override-drawer.tsx";
import "@testing-library/jest-dom/vitest";

const mockGetDefaultModels = vi.fn();
const mockGetInheritedValues = vi.fn();
const mockListAllForProjectForFrontend = vi.fn();
const mockUseFeatureFlag = vi.fn();

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

vi.mock("@langwatch/feature-flag-client", () => ({
  useFeatureFlag: (...args: unknown[]) => mockUseFeatureFlag(...args),
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
    mockUseFeatureFlag.mockReturnValue({ enabled: false, isLoading: false });
  });
  afterEach(() => cleanup());

  describe("given the own-decision-model flag is off for the organization", () => {
    /** @scenario "The drawer offers only decision models for the Instant Evals column" */
    it("offers only LangWatch Instant Preview, never a chat model or an own model", () => {
      renderWithModelProviderHost(<DefaultModelOverrideDrawer editingId="cfg_1" />);

      const listbox = instantEvalsListbox();
      const options = within(listbox)
        .getAllByRole("option", { hidden: true })
        .filter((option) => option.dataset.testid !== "provider-model-selector-inherit");
      expect(options).toHaveLength(1);
      expect(options[0]).toHaveTextContent("LangWatch Instant Preview");
      expect(within(listbox).queryByText(/gpt-5\.5/)).not.toBeInTheDocument();
      expect(within(listbox).queryByText("Inception Mercury Decide")).not.toBeInTheDocument();
    });

    it("asks the flag of the organization, not the project", () => {
      renderWithModelProviderHost(<DefaultModelOverrideDrawer editingId="cfg_1" />);

      expect(mockUseFeatureFlag).toHaveBeenCalledWith(
        expect.objectContaining({ name: "release_instant_evals_own_decision_model" }),
        expect.objectContaining({ organizationId: "org-1", enabled: true }),
      );
    });

    it("reads LangWatch Instant Preview as the value when nothing is set", () => {
      renderWithModelProviderHost(<DefaultModelOverrideDrawer editingId="cfg_1" />);

      const trigger = within(screen.getByTestId("role-row-instant_evals")).getByRole("combobox");
      expect(trigger).toHaveTextContent("LangWatch Instant Preview");
      expect(trigger).not.toHaveTextContent("Not configured");
    });
  });

  describe("given the own-decision-model flag is on for the organization", () => {
    beforeEach(() => mockUseFeatureFlag.mockReturnValue({ enabled: true, isLoading: false }));

    it("lists LangWatch Instant Preview first, then the own decision models", () => {
      renderWithModelProviderHost(<DefaultModelOverrideDrawer editingId="cfg_1" />);

      const options = within(instantEvalsListbox())
        .getAllByRole("option", { hidden: true })
        .filter((option) => option.dataset.testid !== "provider-model-selector-inherit");
      expect(options[0]).toHaveTextContent("LangWatch Instant Preview");
      expect(options.map((option) => option.textContent)).toEqual(
        expect.arrayContaining([
          expect.stringContaining("OpenAI Decisions (gpt-6-luna)"),
          expect.stringContaining("Inception Mercury Decide"),
          expect.stringContaining("Cloudflare Clef"),
        ]),
      );
    });

    it("tells the reader to add a key for a provider the project has not enabled", () => {
      renderWithModelProviderHost(<DefaultModelOverrideDrawer editingId="cfg_1" />);

      const listbox = instantEvalsListbox();
      expect(
        within(listbox).getByText("Add an Inception key in Model Providers first"),
      ).toBeInTheDocument();
      expect(
        within(listbox).queryByText("Add an OpenAI key in Model Providers first"),
      ).not.toBeInTheDocument();
      expect(
        within(listbox).getByText("OpenAI's Decisions API, on your OpenAI key."),
      ).toBeInTheDocument();
    });
  });
});
