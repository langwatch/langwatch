import type * as actualModule from "@langwatch/design-system/scope-chip-picker";
/**
 * @vitest-environment jsdom
 * @see specs/model-providers/custom-model-display-name.feature
 */
import { modelPickerOption } from "@langwatch/model-provider-contract";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeModelProviderHost, renderWithModelProviderHost } from "../../../testing.tsx";
import { DefaultModelOverrideDrawer } from "../default-model-override-drawer.tsx";

const mockCloseDrawer = vi.fn();
const mockGetDefaultModels = vi.fn();
const mockGetInheritedValues = vi.fn();
const mockListAllForProjectForFrontend = vi.fn();
const mockSave = vi.fn();
const mockInvalidate = vi.fn();

vi.mock("@langwatch/browser-host/drawer", () => ({
  useDrawer: () => ({
    closeDrawer: mockCloseDrawer,
    openDrawer: vi.fn(),
    drawerOpen: () => false,
    canGoBack: false,
    goBack: vi.fn(),
    currentDrawer: undefined,
  }),
  useDrawerParams: () => ({}),
}));

// Orthogonal to display-name threading and pulls in its own data hooks.
vi.mock("@langwatch/design-system/scope-chip-picker", async () => {
  const actual = await vi.importActual<typeof actualModule>(
    "@langwatch/design-system/scope-chip-picker",
  );
  return {
    ...actual,
    ScopeChipPicker: () => <div data-testid="scope-chip-picker" />,
  };
});

vi.mock("../../../behavior/model-provider-api.ts", () => ({
  modelProviderApi: {
    useUtils: () => ({ modelProvider: { invalidate: mockInvalidate } }),
    modelProvider: {
      getDefaultModelsForProject: {
        useQuery: () => mockGetDefaultModels(),
      },
      getInheritedValuesForScopes: {
        useQuery: () => mockGetInheritedValues(),
      },
      listAllForProjectForFrontend: {
        useQuery: () => mockListAllForProjectForFrontend(),
      },
      saveDefaultModelsConfig: {
        useMutation: () => ({ mutateAsync: mockSave, isPending: false }),
      },
    },
  },
}));

// jsdom has no Element.scrollTo, which the select machine calls when an item is picked.
Element.prototype.scrollTo = () => undefined;

const MODEL_ID = "gpt-5.1";
const DISPLAY_NAME = "Ada Prod Model";
const PROVIDER = "custom";
const FULL_ID = `${PROVIDER}/${MODEL_ID}`;

const AVAILABLE = {
  organization: { id: "org-1", name: "Acme" },
  teams: [{ id: "team-1", name: "Platform" }],
  projects: [{ id: "proj-1", name: "Acme App", teamId: "team-1" }],
};

const CONFIG_ROW = {
  id: "cfg_1",
  // Only the Default role is pinned - Fast/Embeddings stay on "Inherit"
  // (empty), which is irrelevant to this file's assertions.
  config: { DEFAULT: FULL_ID },
  createdAt: new Date("2026-05-15T12:00:00Z"),
  updatedAt: new Date("2026-05-15T12:00:00Z"),
  authorId: "user-1",
  scopes: [{ type: "PROJECT" as const, id: "proj-1", name: "Acme App" }],
};

const PAYLOAD = {
  projectId: "proj-1",
  teamId: "team-1",
  organizationId: "org-1",
  organizationName: "Acme",
  effective: {
    DEFAULT: null,
    FAST: null,
    EMBEDDINGS: null,
  },
  configs: [CONFIG_ROW],
  available: AVAILABLE,
  features: [],
};

const PROVIDER_ROW = {
  id: "mp_1",
  name: "Custom",
  provider: PROVIDER,
  enabled: true,
  customModels: [{ modelId: MODEL_ID, displayName: DISPLAY_NAME, mode: "chat" as const }],
  customEmbeddingsModels: [],
};

function renderDrawer(editingId = "cfg_1") {
  const host = new FakeModelProviderHost();
  return renderWithModelProviderHost(<DefaultModelOverrideDrawer editingId={editingId} />, host);
}

function roleRow(role: "default" | "fast" | "embeddings") {
  return screen.getByTestId(`role-row-${role}`);
}

/**
 * The trigger is never portaled (only Select.Content is), so plain DOM containment safely scopes it
 * to one role row.
 */
function triggerFor(role: "default" | "fast" | "embeddings") {
  return within(roleRow(role)).getByRole("combobox");
}

/**
 * Resolves the role's OWN listbox via its trigger's `aria-controls`, which @zag-js/select stamps
 * with the same id it gives that trigger's Content - see the file header for why DOM containment
 * alone can't do this (Content portals; Default and Fast also share one option pool).
 */
function listboxFor(role: "default" | "fast" | "embeddings") {
  const contentId = triggerFor(role).getAttribute("aria-controls");
  if (!contentId) {
    throw new Error(`combobox for role "${role}" has no aria-controls`);
  }
  const listbox = document.getElementById(contentId);
  if (!listbox) {
    throw new Error(`no element with id="${contentId}" for role "${role}"`);
  }
  return listbox;
}

describe("<DefaultModelOverrideDrawer/>", () => {
  beforeEach(() => {
    mockGetDefaultModels.mockReturnValue({ data: PAYLOAD, isLoading: false });
    mockGetInheritedValues.mockReturnValue({
      data: { inherited: {}, referenceScope: null },
      isLoading: false,
    });
    mockListAllForProjectForFrontend.mockReturnValue({
      data: [PROVIDER_ROW],
      isLoading: false,
      isError: false,
    });
    mockSave.mockReset();
    mockInvalidate.mockReset();
    mockCloseDrawer.mockReset();
  });
  afterEach(() => cleanup());

  describe("given a project whose Default role is saved as a renamed custom model", () => {
    describe("when the drawer opens editing that config", () => {
      /** @scenario The reported production surface shows the configured display name */
      /** @scenario Dropdown item shows the configured display name */
      it("renders the Default role's dropdown item as the display name", () => {
        renderDrawer();

        expect(within(listboxFor("default")).getByText(DISPLAY_NAME)).toBeInTheDocument();
      });

      /** @scenario Dropdown item shows the configured display name */
      it("does not render the raw model id as the Default role's dropdown item", () => {
        renderDrawer();

        expect(within(listboxFor("default")).queryByText(new RegExp(MODEL_ID))).toBeNull();
      });

      /** @scenario Collapsed selector shows the configured display name */
      it("renders the Default role's collapsed trigger as the display name", () => {
        renderDrawer();

        expect(within(triggerFor("default")).getByText(DISPLAY_NAME)).toBeInTheDocument();
      });

      it("does not render the raw model id as the Default role's trigger value", () => {
        renderDrawer();

        expect(within(triggerFor("default")).queryByText(MODEL_ID)).not.toBeInTheDocument();
      });
    });
  });

  describe("given the provider also has a custom embeddings model", () => {
    const EMBED_ID = "text-embed-3";
    const EMBED_NAME = "Ada Prod Embed";

    describe("when the Embeddings role dropdown is expanded", () => {
      beforeEach(() => {
        mockListAllForProjectForFrontend.mockReturnValue({
          data: [
            {
              ...PROVIDER_ROW,
              customEmbeddingsModels: [
                { modelId: EMBED_ID, displayName: EMBED_NAME, mode: "embedding" as const },
              ],
            },
          ],
          isLoading: false,
          isError: false,
        });
      });

      /** @scenario Custom embeddings model shows the configured display name */
      it("reads the embeddings model's item as its display name, not its model id", () => {
        renderDrawer();

        const listbox = listboxFor("embeddings");
        expect(within(listbox).getByText(EMBED_NAME)).toBeInTheDocument();
        expect(within(listbox).queryByText(new RegExp(EMBED_ID))).toBeNull();
      });
    });
  });

  describe("given the Default role inherits the custom model from a broader scope", () => {
    beforeEach(() => {
      mockGetDefaultModels.mockReturnValue({
        data: { ...PAYLOAD, configs: [{ ...CONFIG_ROW, config: {} }] },
        isLoading: false,
      });
      mockGetInheritedValues.mockReturnValue({
        data: {
          inherited: {
            DEFAULT: { model: FULL_ID, source: "role_default", scope: "organization" },
          },
          referenceScope: { scopeType: "PROJECT", scopeId: "proj-1" },
        },
        isLoading: false,
      });
    });

    describe("when the Default role dropdown is expanded", () => {
      /** @scenario Inherit entry shows the display name without replacing its own label */
      it("names the inherited model in the entry's subtitle and the collapsed placeholder, keeping its own label", () => {
        renderDrawer();

        const entry = within(listboxFor("default")).getByTestId("provider-model-selector-inherit");
        expect(within(entry).getByText(DISPLAY_NAME)).toBeInTheDocument();
        expect(within(entry).getByText("Inherit (from organization)")).toBeInTheDocument();
        expect(within(entry).queryByText(new RegExp(MODEL_ID))).toBeNull();
        expect(within(triggerFor("default")).getByText(DISPLAY_NAME)).toBeInTheDocument();
      });
    });
  });

  describe("given a second custom model beside the renamed one", () => {
    beforeEach(() => {
      mockListAllForProjectForFrontend.mockReturnValue({
        data: [
          {
            ...PROVIDER_ROW,
            customModels: [
              ...PROVIDER_ROW.customModels,
              { modelId: "other-model", displayName: "Other Model", mode: "chat" as const },
            ],
          },
        ],
        isLoading: false,
        isError: false,
      });
    });

    function searchDefaultRole(term: string) {
      renderDrawer();
      const box = within(listboxFor("default"));
      fireEvent.change(box.getByPlaceholderText("Search models"), { target: { value: term } });
      return box;
    }

    describe("when the Default role dropdown is searched by the display name", () => {
      /** @scenario Search by display name finds a renamed model */
      it("keeps the renamed model listed and filters the others out", () => {
        const box = searchDefaultRole("Ada");

        expect(box.getByText(DISPLAY_NAME)).toBeInTheDocument();
        expect(box.queryByText("Other Model")).toBeNull();
      });
    });

    describe("when the Default role dropdown is searched by the model id", () => {
      /** @scenario Search by model id finds a renamed model */
      it("keeps the renamed model listed and filters the others out", () => {
        const box = searchDefaultRole(MODEL_ID);

        expect(box.getByText(DISPLAY_NAME)).toBeInTheDocument();
        expect(box.queryByText("Other Model")).toBeNull();
      });
    });
  });

  describe("given the same provider also offers registry models", () => {
    beforeEach(() => {
      mockListAllForProjectForFrontend.mockReturnValue({
        data: [
          {
            ...PROVIDER_ROW,
            provider: "openai",
            customModels: [{ modelId: "ada-prod-1", displayName: DISPLAY_NAME, mode: "chat" }],
          },
        ],
        isLoading: false,
        isError: false,
      });
    });

    describe("when the Default role dropdown is expanded", () => {
      /** @scenario Registry model labels are unchanged alongside a custom model */
      it("lists the registry models by their own labels and the custom model by its display name", () => {
        renderDrawer();

        const box = within(listboxFor("default"));
        expect(box.getByText("gpt-4o-mini")).toBeInTheDocument();
        expect(box.getByText("gpt-4o")).toBeInTheDocument();
        expect(box.getByText(DISPLAY_NAME)).toBeInTheDocument();
      });

      /** @scenario Registry and alias labels are unchanged by the resolution fix */
      it("keeps registry labels and reads the latest alias as Latest over its resolved model", () => {
        renderDrawer();

        const box = within(listboxFor("default"));
        expect(box.getByText("gpt-4o-mini")).toBeInTheDocument();
        expect(box.getByText("gpt-4o")).toBeInTheDocument();
        expect(box.getByText("Latest")).toBeInTheDocument();
        const { subtitle } = modelPickerOption({
          displayNames: undefined,
          modelValue: "openai/latest",
        });
        expect(subtitle).toBeTruthy();
        expect(box.getAllByText(subtitle as string).length).toBeGreaterThan(0);
      });
    });
  });

  describe.each([
    {
      provider: "custom",
      name: "Ada Prod Model",
    },
    {
      provider: "azure",
      name: "Marketing GPT-5.1",
    },
  ])(
    "given a $provider custom model named $name and a Default role with no model",
    ({ provider, name }) => {
      beforeEach(() => {
        mockGetDefaultModels.mockReturnValue({
          data: { ...PAYLOAD, configs: [{ ...CONFIG_ROW, config: {} }] },
          isLoading: false,
        });
        mockListAllForProjectForFrontend.mockReturnValue({
          data: [
            {
              ...PROVIDER_ROW,
              provider,
              customModels: [{ modelId: MODEL_ID, displayName: name, mode: "chat" as const }],
            },
          ],
          isLoading: false,
          isError: false,
        });
        mockSave.mockResolvedValue({ id: "cfg_1" });
      });

      describe("when the user picks the model from the Default role dropdown and saves", () => {
        /** @scenario Selecting a renamed model stores its model id */
        /** @scenario Selecting a custom-named model still stores the model id */
        it("records the model's full id for the Default role, not its display name", async () => {
          renderDrawer();

          await userEvent.setup().click(triggerFor("default"));
          await userEvent.setup().click(within(listboxFor("default")).getByText(name));
          fireEvent.click(screen.getByTestId("config-save"));

          await vi.waitFor(() => expect(mockSave).toHaveBeenCalled());
          const saved = mockSave.mock.calls[0]?.[0] as { config: Record<string, string> };
          expect(saved.config).toEqual({ DEFAULT: `${provider}/${MODEL_ID}` });
        });
      });
    },
  );
});
