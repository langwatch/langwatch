/**
 * @vitest-environment jsdom
 *
 * The Model Providers page files every write against the ambient project. This
 * renders the real page over the real `useOrganizationTeamProject` — only the
 * network boundary, router, session, and localStorage are stubbed — so the
 * project a provider is actually created against is observed end to end rather
 * than asserted on a hook in isolation.
 *
 * The organization here holds a personal workspace listed before its shared
 * team. That ordering alone used to hand the page the personal project, and an
 * organization's credentials with it.
 *
 * Spec: specs/ai-gateway/governance/personal-workspace-not-ambient-context.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockOrganizationsQuery,
  mockRouter,
  mockLocalStorage,
  mockOpenDrawer,
  idleQuery,
} = vi.hoisted(() => ({
  mockOrganizationsQuery: vi.fn(),
  mockOpenDrawer: vi.fn(),
  idleQuery: () => ({ data: undefined, isLoading: false, isFetched: true }),
  mockRouter: {
    query: {} as Record<string, string>,
    route: "/settings/model-providers",
    pathname: "/settings/model-providers",
    asPath: "/settings/model-providers",
    push: vi.fn(),
    replace: vi.fn(),
  },
  mockLocalStorage: {
    selectedOrganizationId: "",
    selectedTeamId: "",
    selectedProjectSlug: "",
    lastVisitedHomeKind: "",
  } as Record<string, string>,
}));

vi.mock("~/utils/api", () => ({
  api: {
    organization: { getAll: { useQuery: mockOrganizationsQuery } },
    sharedTrace: { get: { useQuery: idleQuery } },
    publicEnv: { useQuery: idleQuery },
    modelProvider: {
      getAllForProject: { useQuery: idleQuery },
      delete: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      // Asked for at render time by the page's connection-test hook, so its
      // absence fails the whole file on a TypeError rather than on anything
      // these tests are about.
      testConnection: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
    },
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
  },
}));

vi.mock("~/utils/auth-client", () => ({
  useSession: () => ({
    data: { user: { id: "user-jane" } },
    status: "authenticated",
  }),
}));

vi.mock("~/utils/compat/next-router", () => ({ useRouter: () => mockRouter }));

vi.mock("usehooks-ts", () => ({
  useLocalStorage: (key: string, initial: string) => [
    mockLocalStorage[key] ?? initial,
    (value: string) => {
      mockLocalStorage[key] = value;
    },
  ],
}));

vi.mock("~/hooks/useAllModelProvidersList", () => ({
  useAllModelProvidersList: () => ({
    providers: [],
    isLoading: false,
    isReady: true,
    refetch: vi.fn(),
  }),
}));

vi.mock("~/hooks/useAvailableScopes", () => ({
  useAvailableScopes: () => ({
    organization: { id: "org-acme", name: "ACME" },
    teams: [],
    projects: [],
    hierarchy: { organization: { id: "org-acme" }, teams: [], projects: [] },
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
    HeaderButton: ({ children, ...props }: { children?: ReactNode }) => (
      <button data-testid="header-add-model-provider" {...props}>
        {children}
      </button>
    ),
  },
}));

// Menu content renders inline so picking a provider is one click away.
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

vi.mock("@langwatch/design-system/tooltip", () => ({
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

import {
  loadedOrganizationsQuery,
  PERSONAL_TEAM,
  SHARED_TEAM,
} from "~/test-utils/personalWorkspaceOrganization";

const { default: ModelProvidersPage } = await import("~/pages/settings/model-providers");

function renderPage() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ModelProvidersPage />
    </ChakraProvider>,
  );
}

describe("given an organization whose personal workspace is listed first", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouter.query = {};
    for (const key of Object.keys(mockLocalStorage)) {
      mockLocalStorage[key] = "";
    }
    mockOrganizationsQuery.mockReturnValue(
      loadedOrganizationsQuery([PERSONAL_TEAM, SHARED_TEAM]),
    );
  });

  afterEach(() => {
    cleanup();
  });

  /** @scenario Organization-scoped credentials are filed against the organization's project */
  it("creates a model provider against the organization's project", () => {
    renderPage();

    fireEvent.click(document.querySelector('[data-menu-item="openai"]')!);

    expect(mockOpenDrawer).toHaveBeenCalledWith("editModelProvider", {
      projectId: "proj-app",
      organizationId: "org-acme",
      providerKey: "openai",
      modelProviderId: "new",
    });
  });

  describe("given the user was last in their personal project", () => {
    beforeEach(() => {
      mockLocalStorage.selectedOrganizationId = "org-acme";
      mockLocalStorage.selectedTeamId = "team-personal";
      mockLocalStorage.selectedProjectSlug = "personal-jane-abc123";
    });

    /** @scenario Leaving the personal project releases it */
    it("still creates the provider against the organization's project", () => {
      renderPage();

      fireEvent.click(document.querySelector('[data-menu-item="openai"]')!);

      expect(mockOpenDrawer).toHaveBeenCalledWith("editModelProvider", {
        projectId: "proj-app",
        organizationId: "org-acme",
        providerKey: "openai",
        modelProviderId: "new",
      });
    });

    /** @scenario Leaving the personal project releases it */
    it("never offers the personal project as the write target", () => {
      renderPage();

      fireEvent.click(document.querySelector('[data-menu-item="openai"]')!);

      expect(mockOpenDrawer).not.toHaveBeenCalledWith(
        "editModelProvider",
        expect.objectContaining({ projectId: "proj-personal" }),
      );
    });
  });
});
