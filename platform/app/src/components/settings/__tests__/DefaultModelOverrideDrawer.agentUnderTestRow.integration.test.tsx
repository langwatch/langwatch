/**
 * @vitest-environment jsdom
 *
 * Issue #6634, AC-N6: the new "scenarios.agent_under_test" DEFAULT-role
 * feature key must render as a real override row in the Default Models
 * drawer, the same as every other DEFAULT-role feature, with its
 * registry-authored displayName/description — not a hardcoded copy this
 * test invents, so the test can't drift from whatever customer-safe copy
 * the coder actually writes into the registry.
 *
 * Follows the same render + query strategy as
 * DefaultModelOverrideDrawer.displayName.integration.test.tsx (see that
 * file's header for why the trigger, not the listbox, is the
 * portal-proof way to scope to one role's row).
 *
 * @see specs/model-providers/model-default-config-cascade.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  featureByKey,
  featuresByRole,
} from "~/server/modelProviders/featureRegistry";
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

vi.mock("~/components/settings/ScopeChipPicker", () => ({
  ScopeChipPicker: () => <div data-testid="scope-chip-picker" />,
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
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

const feature = featureByKey("scenarios.agent_under_test");

const CONFIG_ROW = {
  id: "cfg_1",
  config: {},
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
  effective: { DEFAULT: null, FAST: null, EMBEDDINGS: null },
  configs: [CONFIG_ROW],
  available: {
    organization: { id: "org-1", name: "Acme" },
    teams: [{ id: "team-1", name: "Platform" }],
    projects: [{ id: "proj-1", name: "Acme App", teamId: "team-1" }],
  },
  // The REAL DEFAULT-role registry list, not a curated subset — the
  // drawer's expand chevron for a role only renders when that role's
  // feature list is non-empty (DefaultModelOverrideDrawer.tsx's
  // `canExpand = features.length > 0`), and siblings like
  // "prompt.create_default" / "evaluator.create_default" already exist
  // today. Using the full real list keeps the DEFAULT row expandable
  // both before and after the new key lands, so these tests fail ONLY on
  // the missing scenarios.agent_under_test row/label — never on a
  // precondition this file itself created by curating the feature set.
  features: featuresByRole("DEFAULT"),
};

function renderDrawer() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <DefaultModelOverrideDrawer editingId="cfg_1" />
    </ChakraProvider>,
  );
}

describe("<DefaultModelOverrideDrawer/> — scenarios.agent_under_test row", () => {
  beforeEach(() => {
    mockGetDefaultModels.mockReturnValue({ data: PAYLOAD, isLoading: false });
    mockGetInheritedValues.mockReturnValue({
      data: { inherited: {}, referenceScope: null },
      isLoading: false,
    });
    mockListAllForProjectForFrontend.mockReturnValue({
      data: { providers: [] },
      isLoading: false,
      isError: false,
    });
    mockSave.mockReset();
    mockInvalidate.mockReset();
    mockCloseDrawer.mockReset();
  });
  afterEach(() => cleanup());

  describe("given the registry has registered the agent-under-test feature", () => {
    // Guards the whole file: if this fails, the registry entry doesn't
    // exist yet, so it's absent from `featuresByRole("DEFAULT")` above
    // and every render assertion below is checking for a row that can't
    // possibly be there — see codexRestrictions.unit.test.ts and
    // featureRegistry.unit.test.ts for the direct registry pins.
    it("has a real registry entry to render", () => {
      expect(feature).toBeTruthy();
    });

    describe("when the DEFAULT role row is expanded", () => {
      function expandDefaultRole() {
        renderDrawer();
        fireEvent.click(screen.getByTestId("role-row-default-expand"));
      }

      /** @scenario "A prompt without a model resolves the agent-under-test default" */
      it("renders a feature row for scenarios.agent_under_test", () => {
        expandDefaultRole();

        expect(
          screen.getByTestId("feature-row-scenarios.agent_under_test"),
        ).toBeInTheDocument();
      });

      it("renders the registry's displayName as the row label", () => {
        expandDefaultRole();

        const row = screen.getByTestId(
          "feature-row-scenarios.agent_under_test",
        );
        expect(within(row).getByText(feature!.displayName)).toBeInTheDocument();
      });
    });
  });
});
