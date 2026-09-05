/**
 * @vitest-environment jsdom
 * @see specs/model-providers/custom-model-display-name.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DefaultModelOverrideDrawer } from "../default-model-override-drawer";
import { FakeModelProviderHost, renderWithModelProviderHost } from "../../../testing";

const mockCloseDrawer = vi.fn();
const mockGetDefaultModels = vi.fn();
const mockGetInheritedValues = vi.fn();
const mockListAllForProjectForFrontend = vi.fn();
const mockSave = vi.fn();
const mockInvalidate = vi.fn();

vi.mock("@langwatch/ui-drawer", () => ({
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
vi.mock("@langwatch/authz-web/surfaces/scope-picker", async () => {
  const actual = await vi.importActual<typeof import("@langwatch/authz-web/surfaces/scope-picker")>(
    "@langwatch/authz-web/surfaces/scope-picker",
  );
  return {
    ...actual,
    ScopeChipPicker: () => <div data-testid="scope-chip-picker" />,
  };
});

vi.mock("../../../behavior/model-provider-api", () => ({
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
  return renderWithModelProviderHost(
    <ChakraProvider value={defaultSystem}>
      <DefaultModelOverrideDrawer editingId={editingId} />
    </ChakraProvider>,
    host,
  );
}

function roleRow(role: "default" | "fast" | "embeddings") {
  return screen.getByTestId(`role-row-${role}`);
}

/** The trigger is never portaled (only Select.Content is), so plain DOM
 *  containment safely scopes it to one role row. */
function triggerFor(role: "default" | "fast" | "embeddings") {
  return within(roleRow(role)).getByRole("combobox");
}

/** Resolves the role's OWN listbox via its trigger's `aria-controls`,
 *  which @zag-js/select stamps with the same id it gives that trigger's
 *  Content - see the file header for why DOM containment alone can't do
 *  this (Content portals; Default and Fast also share one option pool). */
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
      it("renders the Default role's dropdown item as the display name", () => {
        renderDrawer();

        expect(within(listboxFor("default")).getByText(DISPLAY_NAME)).toBeInTheDocument();
      });

      it("does not render the raw model id as the Default role's dropdown item", () => {
        renderDrawer();

        expect(within(listboxFor("default")).queryByText(MODEL_ID)).not.toBeInTheDocument();
      });

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
});
