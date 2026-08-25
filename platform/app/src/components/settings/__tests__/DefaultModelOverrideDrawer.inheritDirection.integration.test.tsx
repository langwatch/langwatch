/**
 * @vitest-environment jsdom
 *
 * Customer report (2026-08-13): the Add config drawer at organization
 * scope offered "Inherit (from project)" (inheritance can only flow
 * from wide to narrow), saving with it selected reached the backend as
 * an empty config and surfaced a raw 500, and each save stacked one
 * more row for the same scope.
 *
 * Binds the drawer scenarios in
 * specs/model-providers/role-based-default-models.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { featuresByRole } from "~/server/modelProviders/featureRegistry";
import { DefaultModelOverrideDrawer } from "../DefaultModelOverrideDrawer";

const mockCloseDrawer = vi.fn();
const mockGetDefaultModels = vi.fn();
const mockGetInheritedValues = vi.fn();
const mockListAllForProjectForFrontend = vi.fn();
const mockSave = vi.fn();
const mockInvalidate = vi.fn();
const mockInvalidateModelProvider = vi.fn();
const mockResolvedDefaultGetData = vi.fn();
const mockResolvedDefaultFetch = vi.fn();
const mockToasterCreate = vi.fn();

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

// The picker stub exposes one button that picks the organization scope,
// so create-mode tests can drive the scope selection without the real
// multi-select dropdown.
vi.mock("~/components/settings/ScopeChipPicker", () => ({
  ScopeChipPicker: ({
    onChange,
  }: {
    onChange: (next: Array<{ scopeType: string; scopeId: string }>) => void;
  }) => (
    <button
      type="button"
      data-testid="pick-org-scope"
      onClick={() => onChange([{ scopeType: "ORGANIZATION", scopeId: "org-1" }])}
    />
  ),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      modelProvider: {
        invalidate: mockInvalidateModelProvider,
        getDefaultModelsForProject: { invalidate: mockInvalidate },
        getResolvedDefault: {
          invalidate: vi.fn(),
          getData: mockResolvedDefaultGetData,
          fetch: mockResolvedDefaultFetch,
        },
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
  toaster: { create: (...args: unknown[]) => mockToasterCreate(...args) },
}));

const ORG_CONFIG_ROW = {
  id: "cfg_org",
  config: { DEFAULT: "openai/gpt-5.5" },
  createdAt: new Date("2026-05-15T12:00:00Z"),
  updatedAt: new Date("2026-05-15T12:00:00Z"),
  authorId: "user-1",
  scopes: [{ type: "ORGANIZATION" as const, id: "org-1", name: "Acme" }],
};

const PROJECT_CONFIG_ROW = {
  id: "cfg_proj",
  config: {},
  createdAt: new Date("2026-05-16T12:00:00Z"),
  updatedAt: new Date("2026-05-16T12:00:00Z"),
  authorId: "user-1",
  scopes: [{ type: "PROJECT" as const, id: "proj-1", name: "Acme App" }],
};

function payloadWith(configs: unknown[]) {
  return {
    projectId: "proj-1",
    teamId: "team-1",
    organizationId: "org-1",
    organizationName: "Acme",
    effective: {
      DEFAULT: {
        model: "gemini/gemini-2.5-pro",
        source: "role_default",
        scope: "project",
      },
      FAST: null,
      LANGY: null,
      EMBEDDINGS: null,
    },
    configs,
    available: {
      organization: { id: "org-1", name: "Acme" },
      teams: [{ id: "team-1", name: "Platform" }],
      projects: [{ id: "proj-1", name: "Acme App", teamId: "team-1" }],
    },
    features: featuresByRole("DEFAULT"),
  };
}

function drawerTree(editingId?: string) {
  return (
    <ChakraProvider value={defaultSystem}>
      <DefaultModelOverrideDrawer editingId={editingId} />
    </ChakraProvider>
  );
}

function renderDrawer(editingId?: string) {
  return render(drawerTree(editingId));
}

/** The config payload of the drawer's first save call. */
function savedConfig(): Record<string, string> | undefined {
  return (mockSave.mock.calls[0]?.[0] as { config: Record<string, string> } | undefined)
    ?.config;
}

describe("<DefaultModelOverrideDrawer/> inherit direction and save integrity", () => {
  beforeEach(() => {
    mockGetDefaultModels.mockReturnValue({
      data: payloadWith([ORG_CONFIG_ROW, PROJECT_CONFIG_ROW]),
      isLoading: false,
    });
    mockGetInheritedValues.mockReturnValue({
      data: { inherited: {}, referenceScope: null },
      isLoading: false,
    });
    mockListAllForProjectForFrontend.mockReturnValue({
      data: {
        providers: [
          {
            provider: "openai",
            enabled: true,
            customModels: [],
            customEmbeddingsModels: [],
          },
        ],
      },
      isLoading: false,
      isError: false,
    });
    mockSave.mockReset();
    mockSave.mockResolvedValue({ id: "cfg_org" });
    mockInvalidate.mockReset();
    mockInvalidateModelProvider.mockReset();
    mockInvalidateModelProvider.mockResolvedValue(void 0);
    mockResolvedDefaultGetData.mockReset();
    mockResolvedDefaultGetData.mockReturnValue(null);
    mockResolvedDefaultFetch.mockReset();
    mockResolvedDefaultFetch.mockResolvedValue(null);
    mockCloseDrawer.mockReset();
    mockToasterCreate.mockReset();
  });
  afterEach(() => cleanup());

  describe("when editing a project-scoped config that inherits from the organization", () => {
    /** @scenario The inherit entry names the wider scope the value comes from */
    it("labels the inherit entry with the wider scope, never the project's own view", async () => {
      mockGetInheritedValues.mockReturnValue({
        data: {
          inherited: {
            DEFAULT: {
              model: "openai/gpt-5.5",
              source: "role_default",
              scope: "organization",
            },
          },
          referenceScope: { scopeType: "PROJECT", scopeId: "proj-1" },
        },
        isLoading: false,
      });

      renderDrawer("cfg_proj");

      expect(screen.getAllByText("Inherit (from organization)").length).toBeGreaterThan(
        0,
      );
      expect(screen.queryByText("Inherit (from project)")).not.toBeInTheDocument();

      // The entry is a label over a value that flows down, not a value
      // of its own: leaving it selected saves the key as absent.
      fireEvent.click(screen.getByTestId("config-save"));
      await vi.waitFor(() => expect(mockSave).toHaveBeenCalled());
      expect(savedConfig()).not.toHaveProperty("DEFAULT");
    });
  });

  describe("when adding a config scoped to the organization", () => {
    /** @scenario At organization scope the inherit entry reads "Not configured" */
    it("offers a plain Not configured entry instead of a reverse-direction inherit", () => {
      // The server walk for a picked organization scope excludes the
      // organization itself and has nothing wider, so every key comes
      // back without a cascade hit.
      mockGetInheritedValues.mockReturnValue({
        data: {
          inherited: { DEFAULT: null },
          referenceScope: { scopeType: "ORGANIZATION", scopeId: "org-1" },
        },
        isLoading: false,
      });

      renderDrawer(undefined);
      fireEvent.click(screen.getByTestId("pick-org-scope"));

      expect(screen.getAllByText("Not configured").length).toBeGreaterThan(0);
      expect(screen.queryByText(/Inherit \(from/)).not.toBeInTheDocument();
    });
  });

  describe("when adding a config with no model picked", () => {
    /** @scenario Save is disabled while a new config carries no model at all */
    it("keeps the save button disabled", () => {
      renderDrawer(undefined);

      fireEvent.click(screen.getByTestId("pick-org-scope"));

      expect(screen.getByTestId("config-save")).toBeDisabled();
    });
  });

  describe("when saving an edit", () => {
    /** @scenario Saving an edit targets the config row that was opened */
    it("stays disabled until the target loads, then sends that config's id", async () => {
      mockGetDefaultModels.mockReturnValue({
        data: undefined,
        isLoading: true,
      });
      // One mount throughout, so the unsettled-to-settled transition and
      // the hydration latch it drives are the thing under test. Two
      // separate mounts would each start from a clean latch and prove
      // nothing about either.
      const { rerender } = renderDrawer("cfg_org");
      expect(screen.getByTestId("config-save")).toBeDisabled();

      mockGetDefaultModels.mockReturnValue({
        data: payloadWith([ORG_CONFIG_ROW, PROJECT_CONFIG_ROW]),
        isLoading: false,
      });
      rerender(drawerTree("cfg_org"));

      const save = screen.getByTestId("config-save");
      expect(save).not.toBeDisabled();
      fireEvent.click(save);

      await vi.waitFor(() => {
        expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ id: "cfg_org" }));
      });
      // Hydrated from the settled row, not left empty by the latch.
      expect(savedConfig()).toEqual({ DEFAULT: "openai/gpt-5.5" });
    });

    /** @scenario Retargeting the open drawer to another row saves that row's values */
    it("re-hydrates when the open drawer is pointed at a different row", async () => {
      // The drawer is non-modal and CurrentDrawer renders it without a
      // key, so the pencil behind it swaps `editingId` on the SAME
      // mount. A latch that hydrated only once would keep the first
      // row's values and write them onto the second row.
      const { rerender } = renderDrawer("cfg_org");
      rerender(drawerTree("cfg_proj"));

      fireEvent.click(screen.getByTestId("config-save"));

      await vi.waitFor(() => {
        expect(mockSave).toHaveBeenCalledWith(
          expect.objectContaining({ id: "cfg_proj" }),
        );
      });
      expect(savedConfig()).toEqual({});
    });
  });

  describe("when an edit clears every key back to inherit", () => {
    /** @scenario Editing every key to Inherit tells the user the config was removed */
    it("toasts that the config was removed, not updated", async () => {
      renderDrawer("cfg_proj");

      const save = screen.getByTestId("config-save");
      expect(save).not.toBeDisabled();
      fireEvent.click(save);

      await vi.waitFor(() => {
        expect(mockToasterCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Config removed, every value inherits now",
          }),
        );
      });
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({ id: "cfg_proj", config: {} }),
      );
    });
  });

  describe("when the cache refresh after a saved config fails", () => {
    /** @scenario A cache refresh that fails after the write still reads as saved */
    it("still reports the save as done", async () => {
      mockResolvedDefaultFetch.mockRejectedValue(new Error("resolver unavailable"));
      mockInvalidateModelProvider.mockRejectedValue(new Error("cache sync unavailable"));
      renderDrawer("cfg_proj");

      fireEvent.click(screen.getByTestId("config-save"));

      await vi.waitFor(() => {
        expect(mockToasterCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Config removed, every value inherits now",
          }),
        );
      });
      expect(mockToasterCreate).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "error" }),
      );
    });
  });

  describe("when adding a config for a scope that already has one", () => {
    /** @scenario Adding a config for a scope that already has one says it will replace it */
    it("shows a note that the existing config gets replaced", () => {
      renderDrawer(undefined);

      expect(screen.queryByTestId("replaced-configs-note")).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId("pick-org-scope"));

      const note = screen.getByTestId("replaced-configs-note");
      expect(note).toHaveTextContent("Acme already has default models");
      expect(note).toHaveTextContent("Saving replaces that config");
    });
  });
});
