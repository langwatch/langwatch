/**
 * @vitest-environment jsdom
 *
 * Model Providers settings page for an organization that has no project
 * yet, alongside the ordinary path where one exists.
 *
 * A provider belongs to the organization and reaches the scopes attached
 * to it, so every action on this page works with or without a project.
 * The page used to disable adding, editing and deleting whenever there
 * was no project and offer project creation as the way out, which was a
 * dead end for the buyer whose organization was set up to track coding
 * agents and therefore has no project at all.
 *
 * Spec: specs/model-providers/providers-without-a-project.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockState, mockOpenDrawer, mockDeleteProvider, mockTestConnection } = vi.hoisted(
  () => ({
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
    mockTestConnection: vi.fn(),
  }),
);

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
    hasPermission: (permission: string) => mockState.permissions[permission] ?? false,
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
    useUtils: () => ({
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
      // The page's connection-test hook asks for this at render time, so
      // leaving it out fails every test in the file on a TypeError rather
      // than on anything they are about.
      testConnection: {
        useMutation: () => ({
          mutateAsync: mockTestConnection,
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
  ProviderScopeChips: ({
    scopes,
  }: {
    scopes?: Array<{ scopeType: string; name?: string }>;
  }) => (
    <div
      data-testid="provider-scope-chips"
      data-scopes={(scopes ?? []).map((s) => `${s.scopeType}:${s.name ?? ""}`).join(",")}
    />
  ),
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

const { default: ModelProvidersPage } = await import("~/pages/settings/model-providers");

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
    it("invites adding a model provider rather than a project", () => {
      renderPage();

      expect(screen.getByText("No model providers")).toBeTruthy();
      expect(screen.getByText("Add a model provider to get started")).toBeTruthy();
      expect(screen.queryByText("Create a project first")).toBeNull();
      expect(screen.queryByTestId("empty-state-create-first-project")).toBeNull();
    });

    /** @scenario "The add action is available" */
    it("offers adding a model provider, with no blocked reason on it", () => {
      renderPage();

      const addButton = screen.getByTestId("header-add-model-provider");

      expect(addButton.hasAttribute("disabled")).toBe(false);
      expect(tooltipWith("Create a project first to add a model provider.")).toBeNull();
    });

    /** @scenario "Picking a provider opens its setup" */
    it("opens a list of providers to pick from", () => {
      renderPage();

      expect(document.querySelector('[data-menu-item="openai"]')).toBeTruthy();
      expect(document.querySelector('[data-menu-item="anthropic"]')).toBeTruthy();
    });

    /** @scenario "Picking a provider opens its setup" */
    it("opens the setup for the provider picked, carrying the organization", () => {
      renderPage();

      fireEvent.click(document.querySelector('[data-menu-item="openai"]')!);

      expect(mockOpenDrawer).toHaveBeenCalledWith("editModelProvider", {
        projectId: undefined,
        organizationId: "org-1",
        providerKey: "openai",
        modelProviderId: "new",
      });
    });

    /** @scenario "The add action is available" */
    it("offers the same add action from the empty state itself", () => {
      renderPage();

      const emptyStateAdd = screen.getByTestId("empty-state-add-model-provider");

      expect(emptyStateAdd.hasAttribute("disabled")).toBe(false);
    });

    describe("given a provider is already visible to the organization", () => {
      beforeEach(() => {
        mockState.providers = [openaiRow];
      });

      /** @scenario "The saved provider shows the organization it belongs to" */
      it("lists the provider with its organization scope", () => {
        renderPage();

        // Scoped to the table: "OpenAI" is also one of the choices in the
        // add menu, which is mounted now that adding is available.
        const table = within(screen.getByRole("table"));

        expect(table.getByText("OpenAI")).toBeTruthy();
        expect(
          screen.getByTestId("provider-scope-chips").getAttribute("data-scopes"),
        ).toBe("ORGANIZATION:ACME");
      });

      /** @scenario "Editing it" */
      it("offers editing and deleting it", () => {
        renderPage();

        expect(screen.getByText("Edit Provider")).toBeTruthy();
        expect(screen.getByText("Delete Provider")).toBeTruthy();
        expect(
          tooltipWith("Create a project first to edit or delete providers."),
        ).toBeNull();
      });

      // The row action and the verdict beneath it, driven from the page rather
      // than from the hook. Everything under this heading was previously
      // covered only at the hook, which left the wiring itself unbound: the
      // menu item could stop calling the hook, or the verdict stop rendering,
      // and nothing would have failed.

      /** @scenario "Testing a saved provider uses the credential already stored" */
      it("sends the row id when the connection test is picked", async () => {
        mockTestConnection.mockResolvedValueOnce({ outcome: "verified" });
        renderPage();

        fireEvent.click(document.querySelector('[data-menu-item="test"]')!);

        expect(mockTestConnection).toHaveBeenCalledWith(
          expect.objectContaining({ modelProviderId: "mp-1" }),
        );
        // No endpoint travels with it — see the service for why the absence is
        // the point.
        expect(Object.keys(mockTestConnection.mock.calls[0]![0] as object)).not.toContain(
          "customBaseUrl",
        );
      });

      /** @scenario "A working credential says so" */
      it("shows the verdict on the row it belongs to", async () => {
        mockTestConnection.mockResolvedValueOnce({ outcome: "verified" });
        renderPage();

        fireEvent.click(document.querySelector('[data-menu-item="test"]')!);

        expect(await screen.findByText("Connection works")).toBeTruthy();
      });

      /** @scenario "A provider we cannot check says so instead of reporting success" */
      it("never renders a provider it could not check as working", async () => {
        mockTestConnection.mockResolvedValueOnce({
          outcome: "unchecked",
          reason: "provider_not_probeable",
        });
        renderPage();

        fireEvent.click(document.querySelector('[data-menu-item="test"]')!);

        expect(await screen.findByText(/can't be tested automatically/)).toBeTruthy();
        expect(screen.queryByText("Connection works")).toBeNull();
      });

      /** @scenario "Editing it" */
      it("opens the setup for the row being edited, carrying the organization", () => {
        renderPage();

        fireEvent.click(screen.getByText("Edit Provider"));

        expect(mockOpenDrawer).toHaveBeenCalledWith("editModelProvider", {
          projectId: undefined,
          organizationId: "org-1",
          modelProviderId: "mp-1",
          providerKey: "openai",
        });
      });

      // Opening the confirm dialog is not the behaviour that matters. The
      // delete is scoped by the tenant captured when the row was clicked,
      // and nothing exercised that all the way to the mutation, so the
      // scope could have been wrong or absent without a test noticing.
      /** @scenario "Deleting it" */
      it("deletes the row it was opened on, scoped to the organization", async () => {
        renderPage();

        fireEvent.click(screen.getByText("Delete Provider"));
        expect(screen.getByText("Delete OpenAI?")).toBeTruthy();

        fireEvent.click(screen.getByText("Delete"));

        await vi.waitFor(() => {
          expect(mockDeleteProvider).toHaveBeenCalledWith({
            id: "mp-1",
            projectId: undefined,
            organizationId: "org-1",
            provider: "openai",
          });
        });
      });
    });
  });

  describe("given the user cannot manage model providers", () => {
    beforeEach(() => {
      mockState.permissions = { "project:manage": false };
      mockState.providers = [openaiRow];
    });

    /** @scenario "Someone who cannot manage model providers" */
    it("blocks adding a model provider and says why", () => {
      renderPage();

      expect(
        screen.getByTestId("header-add-model-provider").hasAttribute("disabled"),
      ).toBe(true);
      expect(
        tooltipWith("You need model provider manage permissions to add new providers."),
      ).toBeTruthy();
    });

    /** @scenario "Someone who cannot manage model providers" */
    it("opens no provider list to pick from", () => {
      renderPage();

      fireEvent.click(screen.getByTestId("header-add-model-provider"));

      expect(document.querySelector("[data-menu-item]")).toBeNull();
      expect(mockOpenDrawer).not.toHaveBeenCalled();
    });

    /** @scenario "Someone who cannot manage model providers" */
    it("blocks editing and deleting, and says why", () => {
      renderPage();

      expect(screen.queryByText("Edit Provider")).toBeNull();
      expect(screen.queryByText("Delete Provider")).toBeNull();
      expect(
        tooltipWith(
          "You need model provider manage permissions to edit or delete providers.",
        ),
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
        screen.getByTestId("header-add-model-provider").hasAttribute("disabled"),
      ).toBe(false);
      expect(screen.queryByText("Create a project first")).toBeNull();
    });

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

      it("deletes the row it was opened on, scoped to the project", async () => {
        renderPage();

        fireEvent.click(screen.getByText("Delete Provider"));
        expect(screen.getByText("Delete OpenAI?")).toBeTruthy();

        fireEvent.click(screen.getByText("Delete"));

        await vi.waitFor(() => {
          expect(mockDeleteProvider).toHaveBeenCalledWith({
            id: "mp-1",
            projectId: "proj-1",
            organizationId: "org-1",
            provider: "openai",
          });
        });
      });
    });
  });
});
