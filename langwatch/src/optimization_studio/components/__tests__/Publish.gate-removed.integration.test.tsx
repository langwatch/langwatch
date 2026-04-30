/**
 * @vitest-environment jsdom
 *
 * Integration test for the Publish menu in the optimization studio.
 *
 * Pins the regression: the studio Publish menu must NOT be gated by
 * `usage.activePlan.canPublish`. No Lock icon, no "Subscribe to unlock"
 * tooltip, no redirect to plan management — even when the active plan
 * has canPublish=false.
 *
 * See specs/studio/publish-not-gated.feature.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCanPublish, mockRouterPush, mockTrackEvent, mockTogglePublish } =
  vi.hoisted(() => ({
    mockCanPublish: { current: false as boolean },
    mockRouterPush: vi.fn(),
    mockTrackEvent: vi.fn(),
    mockTogglePublish: vi.fn(),
  }));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: {},
    push: mockRouterPush,
    back: vi.fn(),
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-1" },
    project: { id: "proj-1", slug: "test-project", apiKey: "test-key" },
  }),
}));

vi.mock("~/hooks/usePlanManagementUrl", () => ({
  usePlanManagementUrl: () => ({ url: "/settings/subscription" }),
}));

vi.mock("~/utils/tracking", () => ({
  trackEvent: mockTrackEvent,
}));

vi.mock("~/utils/api", () => {
  const queryStub = (data: unknown) => ({
    useQuery: () => ({ data, isLoading: false, refetch: vi.fn() }),
  });
  const mutationStub = () => ({
    useMutation: () => ({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isLoading: false,
      isPending: false,
    }),
  });
  return {
    api: {
      useContext: () => ({
        optimization: { getComponents: { invalidate: vi.fn() } },
      }),
      limits: {
        getUsage: {
          useQuery: () => ({
            data: {
              activePlan: { canPublish: mockCanPublish.current },
            },
            isLoading: false,
            refetch: vi.fn(),
          }),
        },
      },
      optimization: {
        getPublishedWorkflow: queryStub({
          version: "1.0.0",
          dsl: { nodes: [], edges: [], name: "Test", workflow_id: "wf-1" },
          isComponent: false,
          isEvaluator: false,
        }),
        toggleSaveAsComponent: mutationStub(),
        toggleSaveAsEvaluator: mutationStub(),
        disableAsComponent: mutationStub(),
        disableAsEvaluator: mutationStub(),
        getComponents: { invalidate: vi.fn() },
      },
      datasetRecord: {
        getAll: queryStub([]),
      },
      workflow: {
        publish: mutationStub(),
        commitVersion: mutationStub(),
      },
    },
  };
});

vi.mock("../../hooks/useWorkflowStore", () => ({
  useWorkflowStore: (selector: (s: any) => any) =>
    selector({
      workflow_id: "wf-1",
      workflow_type: "workflow",
      getWorkflow: () => ({
        workflow_id: "wf-1",
        name: "Test Workflow",
        nodes: [],
        edges: [],
        state: {},
      }),
      setLastCommittedWorkflow: vi.fn(),
      setCurrentVersionId: vi.fn(),
      currentVersionId: "v-1",
      checkCanCommitNewVersion: () => false,
    }),
}));

vi.mock("../../hooks/useModelProviderKeys", () => ({
  useModelProviderKeys: () => ({
    hasProvidersWithoutCustomKeys: false,
    nodeProvidersWithoutCustomKeys: [],
  }),
}));

vi.mock("../History", () => ({
  useVersionState: () => ({
    canSaveNewVersion: false,
    versionToBeEvaluated: { version: "1.0.0" },
    versions: { data: [], refetch: vi.fn() },
  }),
}));

vi.mock("../VersionToBeUsed", () => ({
  VersionToBeUsed: () => null,
}));

vi.mock("../AddModelProviderKey", () => ({
  AddModelProviderKey: () => null,
}));

vi.mock("~/components/ui/menu", () => ({
  Menu: {
    Root: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Trigger: ({ children }: { children?: ReactNode }) => (
      <div>{children}</div>
    ),
    Content: ({ children }: { children?: ReactNode }) => (
      <div>{children}</div>
    ),
    Item: ({
      children,
      onClick,
      hidden,
      ...props
    }: {
      children?: ReactNode;
      onClick?: () => void;
      hidden?: boolean;
      [key: string]: any;
    }) =>
      hidden ? null : (
        <button type="button" onClick={onClick} {...props}>
          {children}
        </button>
      ),
  },
}));

vi.mock("~/components/ui/dialog", () => ({
  Dialog: {
    Root: ({ children, open }: { children?: ReactNode; open?: boolean }) =>
      open ? <div>{children}</div> : null,
    Content: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Header: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Title: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    CloseTrigger: () => <div />,
    Body: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Footer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  },
}));

vi.mock("~/components/ui/tooltip", () => ({
  Tooltip: ({
    content,
    children,
  }: {
    content?: ReactNode;
    children?: ReactNode;
  }) => (
    <span data-tooltip-content={typeof content === "string" ? content : ""}>
      {children}
    </span>
  ),
}));

vi.mock("~/components/ui/link", () => ({
  Link: ({
    children,
    href,
    ...props
  }: {
    children?: ReactNode;
    href?: string;
    [key: string]: any;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const { Publish } = await import("../Publish");

function renderPublish() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <Publish isDisabled={false} />
    </ChakraProvider>,
  );
}

describe("studio Publish menu", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  beforeEach(() => {
    mockCanPublish.current = false;
  });

  describe("when the active plan does NOT allow publishing", () => {
    beforeEach(() => {
      mockCanPublish.current = false;
    });

    it("does not render a 'Subscribe to unlock publishing' tooltip", () => {
      renderPublish();
      const tooltips = document.querySelectorAll("[data-tooltip-content]");
      const lockTooltips = Array.from(tooltips).filter((el) =>
        (el.getAttribute("data-tooltip-content") ?? "").includes(
          "Subscribe to unlock publishing",
        ),
      );
      expect(lockTooltips).toHaveLength(0);
    });

    it("renders the Publish workflow menu item with no lock", () => {
      renderPublish();
      const publishItem = screen.getByText(/Publish workflow/i);
      expect(publishItem).toBeDefined();
    });

    it("does not redirect to plan management or fire subscription tracking when Publish is clicked", () => {
      renderPublish();
      const publishButton = screen.getByText(/Publish workflow/i)
        .closest("button");
      expect(publishButton).not.toBeNull();
      fireEvent.click(publishButton!);

      expect(mockRouterPush).not.toHaveBeenCalledWith("/settings/subscription");
      expect(mockTrackEvent).not.toHaveBeenCalledWith(
        "subscription_hook_click",
        expect.anything(),
      );
    });

    it("renders View API Reference and Export Workflow without paywall", () => {
      renderPublish();
      expect(screen.getByText(/View API Reference/i)).toBeDefined();
      expect(screen.getByText(/Export Workflow/i)).toBeDefined();
    });
  });

  describe("when the active plan allows publishing", () => {
    beforeEach(() => {
      mockCanPublish.current = true;
    });

    it("still renders the Publish menu without paywall (regression)", () => {
      renderPublish();
      expect(screen.getByText(/Publish workflow/i)).toBeDefined();
      const tooltips = document.querySelectorAll("[data-tooltip-content]");
      const lockTooltips = Array.from(tooltips).filter((el) =>
        (el.getAttribute("data-tooltip-content") ?? "").includes(
          "Subscribe to unlock publishing",
        ),
      );
      expect(lockTooltips).toHaveLength(0);
    });
  });
});
