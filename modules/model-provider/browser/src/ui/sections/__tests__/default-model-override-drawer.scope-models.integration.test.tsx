import type * as actualModule from "@langwatch/design-system/scope-chip-picker";
/**
 * @vitest-environment jsdom
 * @see modules/model-provider/specs/default-models-scope-model-options.feature
 */
import {
  NO_SCOPE_MODEL_OPTIONS,
  type EmptyScopeProvider,
  type ScopeModelOptions,
} from "@langwatch/model-provider-contract";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeModelProviderHost, renderWithModelProviderHost } from "../../../testing.tsx";
import { DefaultModelOverrideDrawer } from "../default-model-override-drawer.tsx";

type OptionsAnswer = { data?: ScopeModelOptions; isLoading: boolean; isError: boolean };

const asked: unknown[] = [];
let optionsAnswer: OptionsAnswer = {
  data: NO_SCOPE_MODEL_OPTIONS,
  isLoading: false,
  isError: false,
};

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

const CONFIG_ROW = {
  id: "cfg_1",
  config: {},
  createdAt: new Date("2026-05-15T12:00:00Z"),
  updatedAt: new Date("2026-05-15T12:00:00Z"),
  authorId: "user-1",
  scopes: [{ type: "PROJECT" as const, id: "proj-edited", name: "ACME App" }],
};

const PAYLOAD = {
  projectId: "proj-1",
  teamId: "team-1",
  organizationId: "org-1",
  organizationName: "ACME",
  effective: { DEFAULT: null, FAST: null, EMBEDDINGS: null },
  configs: [CONFIG_ROW],
  available: {
    organization: { id: "org-1", name: "ACME" },
    teams: [{ id: "team-1", name: "Platform" }],
    projects: [{ id: "proj-edited", name: "ACME App", teamId: "team-1" }],
  },
  features: [],
};

vi.mock("../../../behavior/model-provider-api.ts", () => ({
  modelProviderApi: {
    instantEval: { access: { useQuery: () => ({ data: undefined, isLoading: true }) } },
    useUtils: () => ({ modelProvider: { invalidate: vi.fn() } }),
    modelProvider: {
      getDefaultModelsForProject: { useQuery: () => ({ data: PAYLOAD, isLoading: false }) },
      getInheritedValuesForScopes: {
        useQuery: () => ({ data: { inherited: {}, referenceScope: null }, isLoading: false }),
      },
      listDecisionModelsForScopes: { useQuery: () => ({ data: [], isLoading: false }) },
      getModelOptionsForScopes: {
        useQuery: (input: unknown) => {
          asked.push(input);
          return optionsAnswer;
        },
      },
      saveDefaultModelsConfig: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    },
  },
}));

Element.prototype.scrollTo = () => undefined;

const EMPTY_AZURE: EmptyScopeProvider = {
  id: "mp_azure",
  provider: "azure",
  name: "Azure OpenAI",
  isSystem: false,
};

function answer(options: Partial<ScopeModelOptions>) {
  optionsAnswer = {
    data: { ...NO_SCOPE_MODEL_OPTIONS, ...options },
    isLoading: false,
    isError: false,
  };
}

function renderDrawer() {
  const host = new FakeModelProviderHost();
  renderWithModelProviderHost(<DefaultModelOverrideDrawer editingId="cfg_1" />, host);
  return host;
}

function defaultListbox() {
  const trigger = within(screen.getByTestId("role-row-default")).getByRole("combobox");
  const listbox = document.getElementById(trigger.getAttribute("aria-controls") ?? "");
  if (!listbox) throw new Error("the Default picker has no listbox");
  return listbox;
}

describe("<DefaultModelOverrideDrawer/> scope models", () => {
  beforeEach(() => {
    asked.length = 0;
    answer({});
  });
  afterEach(() => cleanup());

  describe("given a config on a project scope whose providers run one chat model", () => {
    beforeEach(() =>
      answer({ chat: ["azure/prod-gpt"], displayNames: { "azure/prod-gpt": "Prod GPT" } }),
    );

    /** @scenario "The drawer offers the models of the picked scopes" */
    it("lists that model, asked for the config's own scopes", () => {
      renderDrawer();

      expect(within(defaultListbox()).getByText("Prod GPT")).toBeInTheDocument();
      expect(asked).toContainEqual({
        projectId: "proj-1",
        scopes: [{ scopeType: "PROJECT", scopeId: "proj-edited" }],
      });
    });
  });

  describe("given the scope runs only an Azure provider with no deployments", () => {
    beforeEach(() => answer({ emptyProviders: { chat: [EMPTY_AZURE], embedding: [EMPTY_AZURE] } }));

    /** @scenario "Empty chat pickers explain an Azure provider with no deployments" */
    it("says Azure lists only the deployments added to it and offers to open it", () => {
      renderDrawer();

      const notice = screen.getByTestId("chat-models-empty-notice");
      expect(notice).toHaveTextContent("Azure OpenAI lists only the deployments you add");
      expect(within(notice).getByRole("button", { name: "Open Azure OpenAI" })).toBeInTheDocument();
    });

    /** @scenario "The note opens the provider to add a deployment" */
    it("opens the Azure provider drawer on that row", () => {
      const host = renderDrawer();

      fireEvent.click(
        within(screen.getByTestId("chat-models-empty-notice")).getByRole("button", {
          name: "Open Azure OpenAI",
        }),
      );

      expect(host.drawerOpens).toContainEqual({
        drawer: "editModelProvider",
        params: expect.objectContaining({ providerKey: "azure", modelProviderId: "mp_azure" }),
      });
    });

    /** @scenario "Embeddings name an Azure provider with no embedding deployment" */
    it("tells the Embeddings row to add an embedding deployment, not that it cannot embed", () => {
      renderDrawer();

      const hint = screen.getByTestId("role-row-embeddings-unsupported-hint");
      expect(hint).toHaveTextContent("has no embedding deployment yet");
      expect(hint).not.toHaveTextContent(/ships an embedding API/);
    });
  });

  describe("given an environment-fed Azure provider with no deployments", () => {
    beforeEach(() =>
      answer({
        emptyProviders: {
          chat: [{ ...EMPTY_AZURE, id: "system_azure", isSystem: true }],
          embedding: [],
        },
      }),
    );

    it("opens the Azure provider form to add a row rather than a row that does not exist", () => {
      const host = renderDrawer();

      fireEvent.click(screen.getByRole("button", { name: "Open Azure OpenAI" }));

      expect(host.drawerOpens).toContainEqual({
        drawer: "editModelProvider",
        params: expect.objectContaining({ providerKey: "azure", modelProviderId: "new" }),
      });
    });
  });

  describe("given the scope runs only a provider with no embedding models", () => {
    beforeEach(() => answer({ chat: ["anthropic/claude-sonnet-4"] }));

    /** @scenario "Embeddings with no provider offering embeddings say so plainly" */
    it("says no provider at these scopes offers an embedding model", () => {
      renderDrawer();

      expect(screen.getByTestId("role-row-embeddings-unsupported-hint")).toHaveTextContent(
        "No provider at these scopes offers an embedding model",
      );
      expect(screen.queryByTestId("chat-models-empty-notice")).toBeNull();
    });
  });

  describe("given the scope models read fails", () => {
    beforeEach(() => {
      optionsAnswer = { data: undefined, isLoading: false, isError: true };
    });

    /** @scenario "A failed models read offers no models and no explanation" */
    it("lists no chat model and names no provider", () => {
      renderDrawer();

      expect(within(defaultListbox()).queryAllByRole("option")).toHaveLength(0);
      expect(screen.queryByTestId("chat-models-empty-notice")).toBeNull();
      expect(screen.queryByTestId("role-row-embeddings-unsupported-hint")).toBeNull();
    });
  });
});
