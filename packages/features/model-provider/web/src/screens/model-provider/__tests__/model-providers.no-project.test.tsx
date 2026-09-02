/**
 * @vitest-environment jsdom
 *
 * Model Providers for an organization that has no project yet, alongside the
 * ordinary path where one exists.
 *
 * A provider belongs to the organization and reaches the scopes attached to it,
 * so every action on this page works with or without a project. The page used to
 * disable adding, editing and deleting whenever there was no project and offer
 * project creation as the way out, which was a dead end for the buyer whose
 * organization is set up to track coding agents and therefore has no project at
 * all.
 *
 * Moved from `platform/app/src/pages/settings/__tests__/model-providers.no-project.integration.test.tsx`.
 * The mocks changed and the assertions did not: what was a module mock per
 * platform hook is now one fake host plus one mock of this package's procedure
 * map, and every `expect` below is the one that travelled.
 *
 * Spec: specs/model-providers/providers-without-a-project.feature
 */

import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeModelProviderHost, renderWithModelProviderHost } from "../../../testing";

const { mockState, mockDeleteProvider, mockTestConnection } = vi.hoisted(() => ({
  mockState: {
    providers: [] as Array<Record<string, unknown>>,
  },
  mockDeleteProvider: vi.fn(),
  mockTestConnection: vi.fn(),
}));

vi.mock("../../../behavior/model-provider-api", () => ({
  modelProviderApi: {
    useUtils: () => ({
      organization: { getAll: { invalidate: vi.fn() } },
      modelProvider: { invalidate: vi.fn() },
    }),
    modelProvider: {
      listAllForOrganizationForFrontend: {
        useQuery: () => ({
          data: mockState.providers,
          isLoading: false,
          refetch: vi.fn(),
        }),
      },
      listAllForProjectForFrontend: {
        useQuery: () => ({ data: [], isLoading: false, refetch: vi.fn() }),
      },
      delete: {
        useMutation: () => ({ mutateAsync: mockDeleteProvider, isPending: false }),
      },
      // The screen's connection-test hook asks for this at render time, so
      // leaving it out fails every test in the file on a TypeError rather than
      // on anything they are about.
      testConnection: {
        useMutation: () => ({ mutateAsync: mockTestConnection, isPending: false }),
      },
      getDefaultModelsForProject: {
        useQuery: () => ({ data: void 0, isLoading: true }),
      },
      deleteDefaultModelsConfig: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
    },
  },
}));

vi.mock("@langwatch/authz-web/surfaces/scope-picker", async () => {
  const actual = await vi.importActual<typeof import("@langwatch/authz-web/surfaces/scope-picker")>(
    "@langwatch/authz-web/surfaces/scope-picker",
  );
  return {
    ...actual,
    ScopeFilter: () => <div data-testid="scope-filter" />,
    ProviderScopeChips: ({ scopes }: { scopes?: Array<{ scopeType: string; name?: string }> }) => (
      <div
        data-testid="provider-scope-chips"
        data-scopes={(scopes ?? [])
          .map((scope) => `${scope.scopeType}:${scope.name ?? ""}`)
          .join(",")}
      />
    ),
  };
});

vi.mock("@langwatch/design-system/page-layout", () => ({
  PageLayout: {
    HeaderButton: ({ children, ...props }: { children?: ReactNode; disabled?: boolean }) => (
      <button data-testid="header-add-model-provider" {...props}>
        {children}
      </button>
    ),
  },
}));

// Menu content renders inline so a pick is one click away. Anything the screen
// decides not to mount therefore stays genuinely absent from the DOM.
vi.mock("@langwatch/design-system/menu", () => ({
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
vi.mock("@langwatch/design-system/dialog", () => ({
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

vi.mock("@langwatch/design-system/tooltip", () => ({
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
      <span data-tooltip-content={typeof content === "string" ? content : ""}>{children}</span>
    ),
}));

vi.mock("@langwatch/design-system/trigger-anchor", () => ({
  TriggerAnchor: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

const { default: ModelProvidersScreen } = await import("../model-providers.screen");

const ORGANIZATION_ONLY_SCOPES = {
  organization: { id: "org-1", name: "ACME" },
  teams: [],
  projects: [],
};

function renderPage(host: FakeModelProviderHost) {
  return renderWithModelProviderHost(<ModelProvidersScreen />, host);
}

function hostWithoutProject(grants = ["project:manage", "organization:view"]) {
  return new FakeModelProviderHost({
    scope: { organizationId: "org-1", teamId: "team-1", projectId: void 0 },
    grants: new Set(grants),
    availableScopes: ORGANIZATION_ONLY_SCOPES,
  });
}

function hostWithProject(grants = ["project:manage", "organization:view"]) {
  return new FakeModelProviderHost({
    scope: { organizationId: "org-1", teamId: "team-1", projectId: "proj-1" },
    grants: new Set(grants),
    availableScopes: ORGANIZATION_ONLY_SCOPES,
  });
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

describe("given the Model Providers screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.providers = [];
  });

  afterEach(() => {
    cleanup();
  });

  describe("given the organization has no project yet", () => {
    /** @scenario "Landing on Model Providers without a project" */
    it("invites adding a model provider rather than a project", () => {
      renderPage(hostWithoutProject());

      expect(screen.getByText("No model providers")).toBeTruthy();
      expect(screen.getByText("Add a model provider to get started")).toBeTruthy();
      expect(screen.queryByText("Create a project first")).toBeNull();
      expect(screen.queryByTestId("empty-state-create-first-project")).toBeNull();
    });

    /** @scenario "The add action is available" */
    it("offers adding a model provider, with no blocked reason on it", () => {
      renderPage(hostWithoutProject());

      const addButton = screen.getByTestId("header-add-model-provider");

      expect(addButton.hasAttribute("disabled")).toBe(false);
      expect(tooltipWith("Create a project first to add a model provider.")).toBeNull();
    });

    /** @scenario "Picking a provider opens its setup" */
    it("opens a list of providers to pick from", () => {
      renderPage(hostWithoutProject());

      expect(document.querySelector('[data-menu-item="openai"]')).toBeTruthy();
      expect(document.querySelector('[data-menu-item="anthropic"]')).toBeTruthy();
    });

    /** @scenario "Picking a provider opens its setup" */
    it("opens the setup for the provider picked, carrying the organization", () => {
      const { host } = renderPage(hostWithoutProject());

      fireEvent.click(document.querySelector('[data-menu-item="openai"]')!);

      expect(host.drawerOpens).toEqual([
        {
          drawer: "editModelProvider",
          params: {
            projectId: void 0,
            organizationId: "org-1",
            providerKey: "openai",
            modelProviderId: "new",
          },
        },
      ]);
    });

    /** @scenario "The add action is available" */
    it("offers the same add action from the empty state itself", () => {
      renderPage(hostWithoutProject());

      const emptyStateAdd = screen.getByTestId("empty-state-add-model-provider");

      expect(emptyStateAdd.hasAttribute("disabled")).toBe(false);
    });

    describe("given a provider is already visible to the organization", () => {
      beforeEach(() => {
        mockState.providers = [openaiRow];
      });

      /** @scenario "The saved provider shows the organization it belongs to" */
      it("lists the provider with its organization scope", () => {
        renderPage(hostWithoutProject());

        // Scoped to the table: "OpenAI" is also one of the choices in the add
        // menu, which is mounted now that adding is available.
        const table = within(screen.getByRole("table"));

        expect(table.getByText("OpenAI")).toBeTruthy();
        expect(screen.getByTestId("provider-scope-chips").getAttribute("data-scopes")).toBe(
          "ORGANIZATION:ACME",
        );
      });

      /** @scenario "Editing it" */
      it("offers editing and deleting it", () => {
        renderPage(hostWithoutProject());

        expect(screen.getByText("Edit Provider")).toBeTruthy();
        expect(screen.getByText("Delete Provider")).toBeTruthy();
        expect(tooltipWith("Create a project first to edit or delete providers.")).toBeNull();
      });

      // The row action and the verdict beneath it, driven from the screen rather
      // than from the hook. Everything under this heading was previously covered
      // only at the hook, which left the wiring itself unbound: the menu item
      // could stop calling the hook, or the verdict stop rendering, and nothing
      // would have failed.

      /** @scenario "Testing a saved provider uses the credential already stored" */
      it("sends the row id when the connection test is picked", () => {
        mockTestConnection.mockResolvedValueOnce({ outcome: "verified", valid: true });
        renderPage(hostWithoutProject());

        fireEvent.click(document.querySelector('[data-menu-item="test"]')!);

        expect(mockTestConnection).toHaveBeenCalledWith(
          expect.objectContaining({ modelProviderId: "mp-1" }),
        );
        // No credential and no endpoint travel with it — see the service for why
        // the absence is the point.
        const sent = Object.keys(mockTestConnection.mock.calls[0]![0] as object);
        expect(sent).not.toContain("customBaseUrl");
        expect(sent).not.toContain("customKeys");
        expect(sent).not.toContain("apiKey");
      });

      /** @scenario "A working credential says so" */
      it("shows the verdict on the row it belongs to", async () => {
        mockTestConnection.mockResolvedValueOnce({ outcome: "verified", valid: true });
        renderPage(hostWithoutProject());

        fireEvent.click(document.querySelector('[data-menu-item="test"]')!);

        expect(await screen.findByText("Connection works")).toBeTruthy();
      });

      /** @scenario "A provider we cannot check says so instead of reporting success" */
      it("never renders a provider it could not check as working", async () => {
        mockTestConnection.mockResolvedValueOnce({
          outcome: "unchecked",
          valid: true,
          reason: "provider_not_probeable",
        });
        renderPage(hostWithoutProject());

        fireEvent.click(document.querySelector('[data-menu-item="test"]')!);

        expect(await screen.findByText(/can't be tested automatically/)).toBeTruthy();
        expect(screen.queryByText("Connection works")).toBeNull();
      });

      /** @scenario "A refused credential is explained in our own words" */
      it("explains a refusal without repeating what the provider said", async () => {
        mockTestConnection.mockResolvedValueOnce({
          outcome: "refused",
          valid: false,
          domainError: {
            code: "provider_key_invalid",
            kind: "provider_key_invalid",
            retryable: false,
            meta: { provider: "openai" },
            traceId: void 0,
            spanId: void 0,
            httpStatus: 400,
            fault: "customer",
            reasons: [],
          },
        });
        renderPage(hostWithoutProject());

        fireEvent.click(document.querySelector('[data-menu-item="test"]')!);

        expect(await screen.findByText(/That API key was refused/)).toBeTruthy();
        // Never the raw code, which is what a handled error's message becomes on
        // the wire, and never the upstream's own explanation.
        expect(screen.queryByText(/provider_key_invalid/)).toBeNull();
      });

      /** @scenario "Editing it" */
      it("opens the setup for the row being edited, carrying the organization", () => {
        const { host } = renderPage(hostWithoutProject());

        fireEvent.click(screen.getByText("Edit Provider"));

        expect(host.drawerOpens).toEqual([
          {
            drawer: "editModelProvider",
            params: {
              projectId: void 0,
              organizationId: "org-1",
              modelProviderId: "mp-1",
              providerKey: "openai",
            },
          },
        ]);
      });

      // Opening the confirm dialog is not the behaviour that matters. The delete
      // is scoped by the tenant the screen holds, and nothing exercised that all
      // the way to the mutation, so the scope could have been wrong or absent
      // without a test noticing.
      /** @scenario "Deleting it" */
      it("deletes the row it was opened on, scoped to the organization", async () => {
        renderPage(hostWithoutProject());

        fireEvent.click(screen.getByText("Delete Provider"));
        expect(screen.getByText("Delete OpenAI?")).toBeTruthy();

        fireEvent.click(screen.getByText("Delete"));

        await vi.waitFor(() => {
          expect(mockDeleteProvider).toHaveBeenCalledWith({
            id: "mp-1",
            projectId: void 0,
            organizationId: "org-1",
            provider: "openai",
          });
        });
      });

      it("tells the reader when the deletion is refused", async () => {
        const refusal = { data: { error: { code: "insufficient_permissions" } } };
        mockDeleteProvider.mockRejectedValueOnce(refusal);
        const { host } = renderPage(hostWithoutProject());

        fireEvent.click(screen.getByText("Delete Provider"));
        fireEvent.click(screen.getByText("Delete"));

        await vi.waitFor(() => {
          expect(host.failures).toEqual([
            { error: refusal, fallbackTitle: "Couldn't delete this provider" },
          ]);
        });
      });
    });
  });

  describe("given the user cannot manage model providers", () => {
    beforeEach(() => {
      mockState.providers = [openaiRow];
    });

    /** @scenario "Someone who cannot manage model providers" */
    it("blocks adding a model provider and says why", () => {
      renderPage(hostWithoutProject(["organization:view"]));

      expect(screen.getByTestId("header-add-model-provider").hasAttribute("disabled")).toBe(true);
      expect(
        tooltipWith("You need model provider manage permissions to add new providers."),
      ).toBeTruthy();
    });

    /** @scenario "Someone who cannot manage model providers" */
    it("opens no provider list to pick from", () => {
      const { host } = renderPage(hostWithoutProject(["organization:view"]));

      fireEvent.click(screen.getByTestId("header-add-model-provider"));

      expect(document.querySelector("[data-menu-item]")).toBeNull();
      expect(host.drawerOpens).toEqual([]);
    });

    /** @scenario "Someone who cannot manage model providers" */
    it("blocks editing and deleting, and says why", () => {
      renderPage(hostWithoutProject(["organization:view"]));

      expect(screen.queryByText("Edit Provider")).toBeNull();
      expect(screen.queryByText("Delete Provider")).toBeNull();
      expect(
        tooltipWith("You need model provider manage permissions to edit or delete providers."),
      ).toBeTruthy();
    });
  });

  describe("given the organization has a project", () => {
    it("offers adding a model provider", () => {
      renderPage(hostWithProject());

      expect(screen.getByTestId("header-add-model-provider").hasAttribute("disabled")).toBe(false);
      expect(screen.queryByText("Create a project first")).toBeNull();
    });

    it("opens the setup for the provider picked", () => {
      const { host } = renderPage(hostWithProject());

      fireEvent.click(document.querySelector('[data-menu-item="openai"]')!);

      expect(host.drawerOpens).toEqual([
        {
          drawer: "editModelProvider",
          params: {
            projectId: "proj-1",
            organizationId: "org-1",
            providerKey: "openai",
            modelProviderId: "new",
          },
        },
      ]);
    });

    describe("given a provider is already configured", () => {
      beforeEach(() => {
        mockState.providers = [openaiRow];
      });

      it("offers editing and deleting it", () => {
        renderPage(hostWithProject());

        expect(screen.getByText("Edit Provider")).toBeTruthy();
        expect(screen.getByText("Delete Provider")).toBeTruthy();
      });

      it("opens the setup for the row being edited", () => {
        const { host } = renderPage(hostWithProject());

        fireEvent.click(screen.getByText("Edit Provider"));

        expect(host.drawerOpens).toEqual([
          {
            drawer: "editModelProvider",
            params: {
              projectId: "proj-1",
              organizationId: "org-1",
              modelProviderId: "mp-1",
              providerKey: "openai",
            },
          },
        ]);
      });

      it("deletes the row it was opened on, scoped to the project", async () => {
        renderPage(hostWithProject());

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
