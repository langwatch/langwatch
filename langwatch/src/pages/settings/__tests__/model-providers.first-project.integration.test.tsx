/**
 * @vitest-environment jsdom
 *
 * Model Providers settings page for an organization that has no project
 * yet, alongside the ordinary path where one exists.
 *
 * Spec: specs/model-providers/first-project-required.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockState, mockOpenDrawer, mockDeleteProvider } = vi.hoisted(() => ({
  mockState: {
    project: undefined as { id: string; slug: string } | undefined,
    permissions: { "project:manage": true, "project:create": true } as Record<
      string,
      boolean
    >,
    providers: [] as Array<Record<string, unknown>>,
  },
  mockOpenDrawer: vi.fn(),
  mockDeleteProvider: vi.fn(),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: mockState.project,
    organization: {
      id: "org-1",
      name: "ACME",
      teams: [
        { id: "personal-1", name: "Personal", isPersonal: true, projects: [] },
        { id: "team-1", name: "ACME", isPersonal: false, projects: [] },
      ],
    },
    team: { id: "team-1", name: "ACME" },
    hasPermission: (permission: string) =>
      mockState.permissions[permission] ?? false,
  }),
}));

vi.mock("~/hooks/useAllModelProvidersList", () => ({
  useAllModelProvidersList: () => ({
    providers: mockState.providers,
    isLoading: false,
    isReady: true,
    refetch: vi.fn(),
  }),
}));

vi.mock("~/hooks/useAvailableScopes", () => ({
  useAvailableScopes: () => ({
    organization: { id: "org-1", name: "ACME" },
    teams: [],
    projects: [],
    hierarchy: { organization: { id: "org-1" }, teams: [], projects: [] },
  }),
}));

vi.mock("~/hooks/useUrlScopeFilter", () => ({
  useUrlScopeFilter: () => [{ kind: "all" }, vi.fn()],
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: mockOpenDrawer,
    closeDrawer: vi.fn(),
    drawerOpen: () => false,
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      organization: { getAll: { invalidate: vi.fn() } },
      modelProvider: {
        getAllForProject: { invalidate: vi.fn() },
        getAllForProjectForFrontend: { invalidate: vi.fn() },
        listAllForProjectForFrontend: { invalidate: vi.fn() },
        listAllForOrganizationForFrontend: { invalidate: vi.fn() },
        getResolvedDefault: { invalidate: vi.fn() },
        getDefaultModelsForProject: { invalidate: vi.fn() },
      },
    }),
    modelProvider: {
      delete: {
        useMutation: () => ({
          mutateAsync: mockDeleteProvider,
          isPending: false,
        }),
      },
    },
  },
}));

vi.mock("~/components/SettingsLayout", () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("~/components/settings/DefaultModelsSection", () => ({
  DefaultModelsSection: () => <div data-testid="default-models-section" />,
}));

vi.mock("~/components/settings/CodexCodingDefaultsAsk", () => ({
  CodexCodingDefaultsAskHost: () => null,
}));

vi.mock("~/components/settings/ScopeFilter", () => ({
  ScopeFilter: () => <div data-testid="scope-filter" />,
}));

vi.mock("~/components/settings/ProviderScopeChips", () => ({
  ProviderScopeChips: () => <div data-testid="provider-scope-chips" />,
}));

vi.mock("~/components/ui/layouts/PageLayout", () => ({
  PageLayout: {
    HeaderButton: ({
      children,
      ...props
    }: {
      children?: ReactNode;
      disabled?: boolean;
    }) => (
      <button data-testid="header-add-model-provider" {...props}>
        {children}
      </button>
    ),
  },
}));

// Menu content renders inline so a pick is one click away. Anything the
// page decides not to mount therefore stays genuinely absent from the DOM.
vi.mock("~/components/ui/menu", () => ({
  Menu: {
    Root: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Trigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
    Content: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Item: ({
      children,
      value,
      onClick,
    }: {
      children?: ReactNode;
      value?: string;
      onClick?: (event: { stopPropagation: () => void }) => void;
    }) => (
      <div data-menu-item={value} onClick={onClick}>
        {children}
      </div>
    ),
  },
}));

// The confirm dialog renders inline, for the same reason the menu does: the
// delete path has to be clickable end to end, so the assertion is on what the
// mutation received rather than on the dialog having opened.
vi.mock("~/components/ui/dialog", () => ({
  Dialog: {
    Root: ({ children, open }: { children?: ReactNode; open?: boolean }) =>
      open ? <div data-testid="dialog">{children}</div> : null,
    Content: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Header: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Body: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Footer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Title: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
    Description: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
    Trigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
    ActionTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
    CloseTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  },
}));

vi.mock("~/components/ui/tooltip", () => ({
  Tooltip: ({
    children,
    content,
    disabled,
  }: {
    children?: ReactNode;
    content?: ReactNode;
    disabled?: boolean;
  }) =>
    disabled ? (
      <>{children}</>
    ) : (
      <span data-tooltip-content={typeof content === "string" ? content : ""}>
        {children}
      </span>
    ),
}));

const { default: ModelProvidersPage } = await import(
  "~/pages/settings/model-providers"
);

function renderPage() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ModelProvidersPage />
    </ChakraProvider>,
  );
}

function tooltipWith(reason: string) {
  return document.querySelector(`[data-tooltip-content="${reason}"]`);
}

const openaiRow = {
  id: "mp-1",
  provider: "openai",
  name: "OpenAI",
  enabled: true,
  scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
};

describe("given the Model Providers settings page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.project = undefined;
    mockState.permissions = {
      "project:manage": true,
      "project:create": true,
    };
    mockState.providers = [];
  });

  afterEach(() => {
    cleanup();
  });

  describe("given the organization has no project yet", () => {
    /** @scenario "Landing on Model Providers without a project" */
    it("states that a project comes first, and offers to create one", () => {
      renderPage();

      expect(screen.getByText("Create a project first")).toBeTruthy();
      expect(
        screen.getByText("Model providers are set up inside a project."),
      ).toBeTruthy();
      expect(
        screen.getByTestId("empty-state-create-first-project"),
      ).toBeTruthy();
    });

    /** @scenario "Creating the first project from the Model Providers page" */
    it("creates the first project in the shared team", () => {
      renderPage();

      fireEvent.click(screen.getByTestId("empty-state-create-first-project"));

      expect(mockOpenDrawer).toHaveBeenCalledWith("createProject", {
        organizationId: "org-1",
        defaultTeamId: "team-1",
      });
    });

    /** @scenario "Adding a model provider is unavailable, with the reason on it" */
    it("blocks adding a model provider and says why", () => {
      renderPage();

      const addButton = screen.getByTestId("header-add-model-provider");

      expect(addButton.hasAttribute("disabled")).toBe(true);
      expect(
        tooltipWith("Create a project first to add a model provider."),
      ).toBeTruthy();
    });

    /** @scenario "No provider list opens onto choices that do nothing" */
    it("opens no provider list to pick from", () => {
      renderPage();

      fireEvent.click(screen.getByTestId("header-add-model-provider"));

      expect(screen.queryByText("OpenAI")).toBeNull();
      expect(screen.queryByText("Anthropic")).toBeNull();
      expect(document.querySelector("[data-menu-item]")).toBeNull();
    });

    /** @scenario "No provider list opens onto choices that do nothing" */
    it("never opens the provider setup", () => {
      renderPage();

      fireEvent.click(screen.getByTestId("header-add-model-provider"));

      expect(mockOpenDrawer).not.toHaveBeenCalled();
    });

    describe("given a provider is already visible to the organization", () => {
      beforeEach(() => {
        mockState.providers = [openaiRow];
      });

      /** @scenario "Providers already visible to the organization cannot be edited or deleted" */
      it("lists the provider", () => {
        renderPage();

        expect(screen.getByText("OpenAI")).toBeTruthy();
      });

      /** @scenario "Providers already visible to the organization cannot be edited or deleted" */
      it("blocks editing and deleting it, and says why", () => {
        renderPage();

        expect(screen.queryByText("Edit Provider")).toBeNull();
        expect(screen.queryByText("Delete Provider")).toBeNull();
        expect(
          tooltipWith("Create a project first to edit or delete providers."),
        ).toBeTruthy();
      });
    });
  });

  describe("given the user cannot create projects", () => {
    beforeEach(() => {
      mockState.permissions = {
        "project:manage": true,
        "project:create": false,
      };
    });

    /** @scenario "A member who cannot create projects" */
    it("still states that a project comes first", () => {
      renderPage();

      expect(screen.getByText("Create a project first")).toBeTruthy();
    });

    /** @scenario "A member who cannot create projects" */
    it("blocks creating a project and says why", () => {
      renderPage();

      const createButton = screen.getByTestId(
        "empty-state-create-first-project",
      );

      expect(createButton.hasAttribute("disabled")).toBe(true);
      expect(
        tooltipWith("You need project create permissions to add a project."),
      ).toBeTruthy();
    });
  });

  describe("given the organization has a project", () => {
    beforeEach(() => {
      mockState.project = { id: "proj-1", slug: "acme-app" };
    });

    it("offers adding a model provider", () => {
      renderPage();

      expect(
        screen
          .getByTestId("header-add-model-provider")
          .hasAttribute("disabled"),
      ).toBe(false);
      expect(screen.queryByText("Create a project first")).toBeNull();
    });

    /** @scenario "Adding a provider works once the project exists" */
    it("opens the setup for the provider picked", () => {
      renderPage();

      const openaiOption = document.querySelector('[data-menu-item="openai"]');
      fireEvent.click(openaiOption!);

      expect(mockOpenDrawer).toHaveBeenCalledWith("editModelProvider", {
        projectId: "proj-1",
        organizationId: "org-1",
        providerKey: "openai",
        modelProviderId: "new",
      });
    });

    describe("given a provider is already configured", () => {
      beforeEach(() => {
        mockState.providers = [openaiRow];
      });

      it("offers editing and deleting it", () => {
        renderPage();

        expect(screen.getByText("Edit Provider")).toBeTruthy();
        expect(screen.getByText("Delete Provider")).toBeTruthy();
      });

      it("opens the setup for the row being edited", () => {
        renderPage();

        fireEvent.click(screen.getByText("Edit Provider"));

        expect(mockOpenDrawer).toHaveBeenCalledWith("editModelProvider", {
          projectId: "proj-1",
          organizationId: "org-1",
          modelProviderId: "mp-1",
          providerKey: "openai",
        });
      });

      // Opening the confirm dialog is not the behaviour that matters. The
      // delete is scoped by the projectId captured when the row was clicked,
      // and nothing exercised that all the way to the mutation, so the scope
      // could have been wrong or absent without a test noticing.
      it("deletes the row it was opened on, scoped to the project", async () => {
        renderPage();

        fireEvent.click(screen.getByText("Delete Provider"));
        expect(screen.getByText("Delete OpenAI?")).toBeTruthy();

        fireEvent.click(screen.getByText("Delete"));

        await vi.waitFor(() => {
          expect(mockDeleteProvider).toHaveBeenCalledWith({
            id: "mp-1",
            projectId: "proj-1",
            provider: "openai",
          });
        });
      });
    });
  });
});
