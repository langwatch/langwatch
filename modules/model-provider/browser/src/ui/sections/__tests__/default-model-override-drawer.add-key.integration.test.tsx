/**
 * @vitest-environment jsdom
 * A decision model waiting on a key offers "Add key" in the Instant Evals picker, which opens that
 * provider's form over the drawer; the form hands the model back as `pick` once the key is saved.
 * Binds specs/model-providers/instant-evals-decision-model.feature.
 */
import type * as actualModule from "@langwatch/design-system/scope-chip-picker";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDefaultModelsDraftStore } from "../../../behavior/default-models-draft.store.ts";
import { ModelProviderHostProvider } from "../../../model/model-provider-host.ts";
import { FakeModelProviderHost, renderWithModelProviderHost } from "../../../testing.tsx";
import { DefaultModelOverrideDrawer } from "../default-model-override-drawer.tsx";
import "@testing-library/jest-dom/vitest";

const {
  mockOpenDrawer,
  mockUpdateDrawerParams,
  mockListDecisionModels,
  mockGetDefaultModels,
  ownModelFlag,
} = vi.hoisted(() => ({
  mockOpenDrawer: vi.fn(),
  mockUpdateDrawerParams: vi.fn(),
  ownModelFlag: { isLoading: false },
  mockListDecisionModels: vi.fn(),
  mockGetDefaultModels: vi.fn(),
}));

vi.mock("@langwatch/feature-flag-client", () => ({
  useFeatureFlag: (flag: { name: string }) => {
    const isOwnModel = flag.name === "release_instant_evals_own_decision_model";
    const isLoading = isOwnModel && ownModelFlag.isLoading;
    return { enabled: isOwnModel && !isLoading, isLoading };
  },
}));

vi.mock("@langwatch/browser-host/drawer", () => ({
  useDrawer: () => ({
    closeDrawer: vi.fn(),
    openDrawer: mockOpenDrawer,
    drawerOpen: () => false,
    canGoBack: false,
    goBack: vi.fn(),
    currentDrawer: undefined,
  }),
  useDrawerParams: () => ({}),
  updateDrawerParams: mockUpdateDrawerParams,
}));

vi.mock("@langwatch/design-system/scope-chip-picker", async () => {
  const actual = await vi.importActual<typeof actualModule>(
    "@langwatch/design-system/scope-chip-picker",
  );
  return { ...actual, ScopeChipPicker: () => <div data-testid="scope-chip-picker" /> };
});

vi.mock("../../../behavior/model-provider-api.ts", () => ({
  modelProviderApi: {
    instantEval: {
      access: {
        useQuery: () => ({
          data: { hostedReleased: false, offer: "not_in_license" },
          isLoading: false,
        }),
      },
    },
    useUtils: () => ({ modelProvider: { invalidate: vi.fn() } }),
    modelProvider: {
      getDefaultModelsForProject: { useQuery: () => mockGetDefaultModels() },
      getInheritedValuesForScopes: {
        useQuery: () => ({ data: { inherited: {}, referenceScope: null }, isLoading: false }),
      },
      listAllForProjectForFrontend: {
        useQuery: () => ({ data: [], isLoading: false, isError: false }),
      },
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

const INCEPTION = "inception/decisions:mercury-decide";
const INCEPTION_PICKABLE = { value: INCEPTION, label: "Inception Mercury Decide" };

function loaded(data: unknown[]) {
  return { data, isLoading: false, isSuccess: true, isFetching: false };
}

function instantEvalsTrigger() {
  return within(screen.getByTestId("role-row-instant_evals")).getByRole("combobox");
}

function instantEvalsOption(title: string) {
  const listbox = document.getElementById(instantEvalsTrigger().getAttribute("aria-controls")!);
  if (!listbox) throw new Error("no listbox for the Instant Evals row");
  const option = within(listbox)
    .getAllByRole("option", { hidden: true })
    .find((row) => within(row).queryByText(title));
  if (!option) throw new Error(`no option titled ${title}`);
  return option;
}

describe("<DefaultModelOverrideDrawer/> Add key on a decision model", () => {
  beforeEach(() => {
    mockGetDefaultModels.mockReturnValue({ data: PAYLOAD, isLoading: false });
    mockListDecisionModels.mockReturnValue(loaded([]));
  });
  afterEach(() => {
    mockOpenDrawer.mockReset();
    mockUpdateDrawerParams.mockReset();
    ownModelFlag.isLoading = false;
    useDefaultModelsDraftStore.getState().clear();
    cleanup();
  });

  describe("given I may manage model providers and my project has no Inception key", () => {
    /** @scenario "A decision model whose provider has no key offers to add one in place" */
    it("offers Add key on the Inception row, which stays unpickable", () => {
      renderWithModelProviderHost(<DefaultModelOverrideDrawer editingId="cfg_1" />);

      const inception = instantEvalsOption("Inception Mercury Decide");
      expect(inception).toHaveAttribute("aria-disabled", "true");
      expect(within(inception).getByRole("button", { name: "Add key", hidden: true })).toBeTruthy();
    });

    /** @scenario "A decision model whose provider has no key offers to add one in place" */
    it("opens the Inception provider form over the drawer, handing it the model", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      renderWithModelProviderHost(<DefaultModelOverrideDrawer editingId="cfg_1" />);

      await user.click(instantEvalsTrigger());
      await user.click(
        within(instantEvalsOption("Inception Mercury Decide")).getByRole("button", {
          name: "Add key",
          hidden: true,
        }),
      );

      expect(mockOpenDrawer).toHaveBeenCalledWith(
        "editModelProvider",
        {
          projectId: "proj-1",
          organizationId: "org-1",
          providerKey: "inception",
          modelProviderId: "new",
          returnPick: INCEPTION,
        },
        { replace: false },
      );
      expect(instantEvalsTrigger()).toHaveTextContent("Choose a decision model");
    });

    /** @scenario "Edits made before Add key are still there when the drawer comes back" */
    it("keeps the unsaved draft for the drawer to restore", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      renderWithModelProviderHost(<DefaultModelOverrideDrawer editingId="cfg_1" />);

      await user.click(instantEvalsTrigger());
      await user.click(
        within(instantEvalsOption("Inception Mercury Decide")).getByRole("button", {
          name: "Add key",
          hidden: true,
        }),
      );

      expect(useDefaultModelsDraftStore.getState().draft).toEqual({
        target: "cfg_1",
        scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
        config: { DEFAULT: "openai/gpt-5.5" },
      });
    });
  });

  describe("given the drawer comes back from the provider form with a kept draft", () => {
    /** @scenario "Edits made before Add key are still there when the drawer comes back" */
    it("restores the scopes picked before Add key, then forgets the draft", () => {
      useDefaultModelsDraftStore.getState().keep({
        target: "cfg_1",
        scopes: [{ scopeType: "TEAM", scopeId: "team-1" }],
        config: { DEFAULT: "openai/gpt-5.5" },
      });
      renderWithModelProviderHost(<DefaultModelOverrideDrawer editingId="cfg_1" />);

      const lastInput = mockListDecisionModels.mock.calls.at(-1)?.[0];
      expect(lastInput).toMatchObject({ scopes: [{ scopeType: "TEAM", scopeId: "team-1" }] });
      expect(useDefaultModelsDraftStore.getState().draft).toBeNull();
    });

    it("ignores a draft kept for another config", () => {
      useDefaultModelsDraftStore.getState().keep({
        target: "cfg_other",
        scopes: [{ scopeType: "TEAM", scopeId: "team-1" }],
        config: {},
      });
      renderWithModelProviderHost(<DefaultModelOverrideDrawer editingId="cfg_1" />);

      const lastInput = mockListDecisionModels.mock.calls.at(-1)?.[0];
      expect(lastInput).toMatchObject({
        scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
      });
    });
  });

  describe("given I may not manage model providers", () => {
    /** @scenario "A reader who may not manage model providers is offered no Add key" */
    it("offers no Add key and still says which key to add", () => {
      renderWithModelProviderHost(
        <DefaultModelOverrideDrawer editingId="cfg_1" />,
        new FakeModelProviderHost({ grants: new Set(["organization:view"]) }),
      );

      const inception = instantEvalsOption("Inception Mercury Decide");
      expect(within(inception).queryByRole("button", { hidden: true })).toBeNull();
      expect(inception).toHaveTextContent("Add an Inception key in Model Providers to use it.");
    });
  });

  describe("given the provider form handed back a model", () => {
    /** @scenario "Saving the key returns to the Default models drawer with the model picked" */
    it("picks it once the new key lets it run, unsaved until the drawer is saved", () => {
      mockListDecisionModels.mockReturnValue(loaded([INCEPTION_PICKABLE]));
      renderWithModelProviderHost(
        <DefaultModelOverrideDrawer editingId="cfg_1" pick={INCEPTION} />,
      );

      expect(instantEvalsTrigger()).toHaveTextContent("Inception Mercury Decide");
    });

    /** @scenario "A picked model the new key does not reach is left unpicked" */
    it("leaves the column unchanged when the key does not reach every scope", () => {
      mockListDecisionModels.mockReturnValue(loaded([]));
      renderWithModelProviderHost(
        <DefaultModelOverrideDrawer editingId="cfg_1" pick={INCEPTION} />,
      );

      expect(instantEvalsTrigger()).toHaveTextContent("Choose a decision model");
      expect(instantEvalsOption("Inception Mercury Decide")).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    });

    /** @scenario "Saving the key returns to the Default models drawer with the model picked" */
    it("waits for the own decision model flag before picking", () => {
      ownModelFlag.isLoading = true;
      mockListDecisionModels.mockReturnValue(loaded([INCEPTION_PICKABLE]));
      const drawer = () => <DefaultModelOverrideDrawer editingId="cfg_1" pick={INCEPTION} />;
      const { host, rerender } = renderWithModelProviderHost(drawer());
      expect(instantEvalsTrigger()).toHaveTextContent("Choose a decision model");

      ownModelFlag.isLoading = false;
      rerender(<ModelProviderHostProvider value={host}>{drawer()}</ModelProviderHostProvider>);

      expect(instantEvalsTrigger()).toHaveTextContent("Inception Mercury Decide");
    });

    /** @scenario "Edits made before Add key are still there when the drawer comes back" */
    it("takes the handed-back model out of the address once it is picked", () => {
      mockListDecisionModels.mockReturnValue(loaded([INCEPTION_PICKABLE]));
      renderWithModelProviderHost(
        <DefaultModelOverrideDrawer editingId="cfg_1" pick={INCEPTION} />,
      );

      expect(mockUpdateDrawerParams).toHaveBeenCalledWith({ pick: undefined }, { push: false });
    });

    /** @scenario "A picked model the new key does not reach is left unpicked" */
    it("takes the handed-back model out of the address when it is left unpicked", () => {
      mockListDecisionModels.mockReturnValue(loaded([]));
      renderWithModelProviderHost(
        <DefaultModelOverrideDrawer editingId="cfg_1" pick={INCEPTION} />,
      );

      expect(mockUpdateDrawerParams).toHaveBeenCalledWith({ pick: undefined }, { push: false });
    });

    it("waits for the decision models to be read again before picking", () => {
      mockListDecisionModels.mockReturnValue({ ...loaded([]), isFetching: true });
      renderWithModelProviderHost(
        <DefaultModelOverrideDrawer editingId="cfg_1" pick={INCEPTION} />,
      );

      expect(instantEvalsTrigger()).toHaveTextContent("Choose a decision model");
    });
  });

  describe("given the setup address opened a new config at the organization", () => {
    /** @scenario "The Instant Evals setup address opens the decision model picker" */
    it("starts on the organization scope with the Instant Evals picker open", async () => {
      renderWithModelProviderHost(
        <DefaultModelOverrideDrawer
          scopeType="ORGANIZATION"
          scopeId="org-1"
          focusRole="INSTANT_EVALS"
        />,
      );

      const lastInput = mockListDecisionModels.mock.calls.at(-1)?.[0];
      expect(lastInput).toMatchObject({
        scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
      });
      await waitFor(() => expect(instantEvalsTrigger()).toHaveAttribute("aria-expanded", "true"));
    });
  });
});
