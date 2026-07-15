/**
 * @vitest-environment jsdom
 *
 * Issue #5759: the Default Models override drawer builds its own
 * `displayNames` map (`buildCustomModelDisplayNames`) from the project's
 * provider rows and threads it into every role's `ProviderModelSelector`.
 * The map-build itself is covered by customModelDisplayNames' own unit
 * tests, and `ProviderModelSelector`'s rendering of a `displayNames` prop
 * is covered by ProviderModelSelector.displayName.integration.test.tsx -
 * but nothing exercised the WIRING between them: "drawer fetches provider
 * rows" -> "drawer builds displayNames" -> "drawer passes
 * displayNames={displayNames} to <ProviderModelSelector>". That chain was
 * pinned only by manual screenshots. `displayNames` is an OPTIONAL prop,
 * so a refactor that silently drops `displayNames={displayNames}` from a
 * role row's <ProviderModelSelector> still compiles and still passes
 * every other existing test.
 *
 * Renders the real `DefaultModelOverrideDrawer` (not a stub) with only
 * the tRPC boundary + peripheral hooks mocked, so the whole chain - map
 * build, prop threading, dropdown + trigger render - runs for real.
 *
 * Query strategy - two layers:
 *
 * 1. Select.Content (role="listbox") is mounted-but-hidden regardless of
 *    open state (same as ProviderModelSelector.displayName.integration.
 *    test.tsx), and Select.HiddenSelect mirrors every item as a native
 *    <option>, so unscoped getByText can double-match. That harness
 *    handles it by scoping to a single global listbox/trigger - not
 *    available here, because this drawer renders THREE role rows
 *    (Default/Fast/Embeddings), each with its OWN <ProviderModelSelector>.
 *
 * 2. `~/components/ui/select.tsx`'s SelectContent portals by default
 *    (`portalled = true`, and ProviderModelSelector never overrides it),
 *    so a role's listbox is NOT a DOM descendant of its own
 *    `role-row-<role>` container - plain DOM-containment scoping can't
 *    isolate "the Default role's dropdown" from the other two. Worse,
 *    Default and Fast share the exact same chat-model pool
 *    (`modelOptionsByRole` in DefaultModelOverrideDrawer.tsx builds one
 *    `chatOptions` list and reuses it for both roles), so the renamed
 *    model is a legitimate, real option in BOTH dropdowns - an unscoped
 *    `getAllByRole("listbox")[0]` guess would be fragile even if it
 *    happened to pass.
 *
 *    Verified directly against @zag-js/select's connect module
 *    (node_modules/.pnpm/@zag-js+select@1.41.2/node_modules/@zag-js/select/
 *    dist/select.connect.mjs):
 *    `getTriggerProps()` stamps `"aria-controls": dom.getContentId(scope)`
 *    on the trigger (role="combobox"), and `getContentProps()` stamps the
 *    SAME id plus `role: "listbox"` on its own Content. That id pairing
 *    is per-<Select.Root> instance and portal-proof, so resolving a
 *    role's listbox FROM its own row's trigger (found by plain DOM
 *    containment, since only Content portals - the trigger does not) is
 *    the one collision-proof way to scope to a single role's dropdown.
 *    (Also verified the native hidden <select> carries `"aria-hidden":
 *    true` in the same module, which is why the working harness's
 *    unscoped `getByRole("combobox")` never trips over it either.)
 *
 * `~/components/settings/ScopeChipPicker` is stubbed the same way
 * AddOverrideDrawer.editMode.integration.test.tsx stubs it ("ScopeChipPicker
 * pulls in data hooks we don't need here") - it's orthogonal to display-name
 * threading, and the assertions below never touch scope-picking UI.
 *
 * @see specs/model-providers/custom-model-display-name.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DefaultModelOverrideDrawer } from "../DefaultModelOverrideDrawer";

const mockCloseDrawer = vi.fn();
const mockGetDefaultModels = vi.fn();
const mockGetInheritedValues = vi.fn();
const mockListAllForProjectForFrontend = vi.fn();
const mockSave = vi.fn();
const mockInvalidate = vi.fn();

vi.mock("~/hooks/useDrawer", () => ({
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

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "acme-app", name: "Acme App" },
    organization: { id: "org-1", name: "Acme" },
    team: { id: "team-1", name: "Platform" },
    hasPermission: () => true,
  }),
}));

// Orthogonal to display-name threading and pulls in its own data hooks -
// see AddOverrideDrawer.editMode.integration.test.tsx for the same stub
// on the same component.
vi.mock("~/components/settings/ScopeChipPicker", () => ({
  ScopeChipPicker: () => <div data-testid="scope-chip-picker" />,
}));

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      modelProvider: {
        getDefaultModelsForProject: { invalidate: mockInvalidate },
        getResolvedDefault: { invalidate: vi.fn() },
      },
    }),
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

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
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
  return render(
    <ChakraProvider value={defaultSystem}>
      <DefaultModelOverrideDrawer editingId={editingId} />
    </ChakraProvider>,
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
      data: { providers: [PROVIDER_ROW] },
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
      it("renders the Default role's dropdown item as the display name", () => {
        renderDrawer();

        expect(
          within(listboxFor("default")).getByText(DISPLAY_NAME),
        ).toBeInTheDocument();
      });

      it("does not render the raw model id as the Default role's dropdown item", () => {
        renderDrawer();

        expect(
          within(listboxFor("default")).queryByText(MODEL_ID),
        ).not.toBeInTheDocument();
      });

      it("renders the Default role's collapsed trigger as the display name", () => {
        renderDrawer();

        expect(
          within(triggerFor("default")).getByText(DISPLAY_NAME),
        ).toBeInTheDocument();
      });

      it("does not render the raw model id as the Default role's trigger value", () => {
        renderDrawer();

        expect(
          within(triggerFor("default")).queryByText(MODEL_ID),
        ).not.toBeInTheDocument();
      });
    });
  });
});
