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
      onClick={() =>
        onChange([{ scopeType: "ORGANIZATION", scopeId: "org-1" }])
      }
    />
  ),
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

function renderDrawer(editingId?: string) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <DefaultModelOverrideDrawer editingId={editingId} />
    </ChakraProvider>,
  );
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
    mockCloseDrawer.mockReset();
    mockToasterCreate.mockReset();
  });
  afterEach(() => cleanup());

  describe("when editing a project-scoped config that inherits from the organization", () => {
    /** @scenario The inherit entry names the wider scope the value comes from */
    it("labels the inherit entry with the wider scope, never the project's own view", () => {
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

      expect(
        screen.getAllByText("Inherit (from organization)").length,
      ).toBeGreaterThan(0);
      expect(
        screen.queryByText("Inherit (from project)"),
      ).not.toBeInTheDocument();
    });
  });

  describe("when editing the organization-scoped config", () => {
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

      renderDrawer("cfg_org");

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
      renderDrawer("cfg_org");
      expect(screen.getByTestId("config-save")).toBeDisabled();
      cleanup();

      mockGetDefaultModels.mockReturnValue({
        data: payloadWith([ORG_CONFIG_ROW, PROJECT_CONFIG_ROW]),
        isLoading: false,
      });
      renderDrawer("cfg_org");
      const save = screen.getByTestId("config-save");
      expect(save).not.toBeDisabled();
      fireEvent.click(save);

      await vi.waitFor(() => {
        expect(mockSave).toHaveBeenCalledWith(
          expect.objectContaining({ id: "cfg_org" }),
        );
      });
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

  describe("when adding a config for a scope that already has one", () => {
    /** @scenario Adding a config for a scope that already has one says it will replace it */
    it("shows a note that the existing config gets replaced", () => {
      renderDrawer(undefined);

      expect(
        screen.queryByTestId("replaced-configs-note"),
      ).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId("pick-org-scope"));

      const note = screen.getByTestId("replaced-configs-note");
      expect(note).toHaveTextContent("Acme already has default models");
      expect(note).toHaveTextContent("Saving replaces that config");
    });
  });
});
