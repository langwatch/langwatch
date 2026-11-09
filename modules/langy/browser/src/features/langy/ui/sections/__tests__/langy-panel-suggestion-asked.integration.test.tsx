/**
 * A suggestion picked in the empty Langy panel is the member's question, counted once as asked
 * from the composer.
 * @vitest-environment jsdom
 * @see modules/dashboard/specs/dashboards-telemetry.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PROJECT_ID = "project-demo";

const sendMessage = vi.hoisted(() => vi.fn());

// A loaded project with no traces yet, so the empty panel offers its first suggestions.
vi.mock("../../../../../behavior/home/use-project-reach.ts", () => ({
  useProjectReach: () => ({
    isLoading: false,
    hasTraces: false,
    hasEvaluations: false,
    hasExperiments: false,
  }),
}));

if (typeof window !== "undefined" && !window.ResizeObserver) {
  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
}

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: [],
    sendMessage,
    stop: vi.fn(),
    status: "ready",
    setMessages: vi.fn(),
    error: undefined,
    clearError: vi.fn(),
    regenerate: vi.fn(),
  }),
}));

const currentDrawerRef = { current: undefined as string | undefined };
vi.mock("@langwatch/browser-host/drawer", () => ({
  useDrawer: () => ({
    currentDrawer: currentDrawerRef.current,
    openDrawer: vi.fn(),
    closeDrawer: vi.fn(),
    goBack: vi.fn(),
  }),
}));

vi.mock("../../elements/langy-model-pill.tsx", () => ({
  LangyModelPill: () => <div data-testid="model-pill" />,
}));

const ONE_CONVERSATION = {
  id: "conv-1",
  title: "Debugging the trace pipeline",
  isShared: false,
  isOwn: true,
  messageCount: 3,
  lastActivityAtMs: Date.now(),
};

vi.mock("../../../../../behavior/langy-api.ts", async () => {
  const { createTrpcUtils, idleQuery, withFallback } =
    await import("../../../__tests__/support/langy-api-mock.ts");

  const trpcUtils = createTrpcUtils();

  const explicitApi: Record<string, unknown> = {
    langy: withFallback({
      list: {
        useInfiniteQuery: () => ({
          ...idleQuery(),
          data: { pages: [{ items: [ONE_CONVERSATION], nextCursor: null }] },
          fetchNextPage: () => Promise.resolve(),
          hasNextPage: false,
          isFetchingNextPage: false,
        }),
      },
      modelsAllowed: {
        useQuery: () => ({
          data: { modelsAllowed: null },
          isLoading: false,
          isError: false,
        }),
      },
      messages: {
        useQuery: () => ({
          data: undefined,
          isLoading: false,
          isFetching: false,
          isError: false,
        }),
      },
      stopTurn: { useMutation: () => ({ mutateAsync: () => Promise.resolve() }) },
      onConversationUpdate: { useSubscription: () => undefined },
    }),
    useUtils: () => trpcUtils,
    useContext: () => trpcUtils,
    modelProvider: {
      getResolvedDefault: {
        useQuery: () => ({
          data: { model: "openai/gpt-5-mini" },
          isLoading: false,
          isSuccess: true,
          isError: false,
          refetch: () => Promise.resolve(),
        }),
      },
      listAllForProjectForFrontend: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
      setRoleAssignmentForScope: { useMutation: () => ({ mutateAsync: () => Promise.resolve() }) },
      setFeatureOverrideForScope: { useMutation: () => ({ mutateAsync: () => Promise.resolve() }) },
    },
    virtualKeys: {
      list: { useQuery: () => ({ data: undefined, isLoading: false }) },
    },
    github: {
      getConnectionStatus: {
        useQuery: () => ({ data: undefined, isLoading: false, isError: true }),
      },
      disconnect: { useMutation: () => ({ mutate: () => undefined, isPending: false }) },
    },
  };

  return { api: withFallback(explicitApi) };
});

import { useLangyStore } from "../../../../../behavior/langy.store.ts";
import {
  LangyHostApi,
  LangyHostProvider,
  type LangyRouteReading,
} from "../../../../../model/langy-host.ts";
import { LangyProvider } from "../../../../tools/ui/sections/langy-page-context.tsx";
import {
  RecordingAnalyticsProvider,
  RecordingUiAnalytics,
} from "../../../__tests__/recording-analytics.test-helpers.tsx";
import { LangySidecar } from "../langy-panel.tsx";

const tracked = new RecordingUiAnalytics();

vi.mock("@langwatch/feature-flag-client", () => ({
  useFeatureFlag: () => ({ enabled: false, isLoading: false }),
}));

class FakeLangyHost extends LangyHostApi {
  project() {
    return { id: PROJECT_ID, slug: "demo", name: "demo" };
  }
  organization() {
    return { id: "org-1" };
  }
  team() {
    return { id: "team-1", isPersonal: false, members: [{ userId: "user-1" }] };
  }
  organizationRole() {
    return "MEMBER";
  }
  currentUser() {
    return { id: "user-1", email: "staff@langwatch.ai" };
  }
  hasOrganizationPermission() {
    return false;
  }
  hasPermission() {
    return true;
  }
  isLoading() {
    return false;
  }
  isDemoProject() {
    return false;
  }
  route(): LangyRouteReading {
    return { params: {}, query: {}, pathname: "/demo/traces" };
  }
  setQuery() {}
  navigate() {}
  planManagementUrl() {
    return undefined;
  }
  succeeded() {}
  failed() {}
}

const Wrapper = ({ children }: { children: ReactNode }) => (
  <DesignSystemProvider forcedTheme="light">
    <RecordingAnalyticsProvider analytics={tracked}>
      <LangyHostProvider value={new FakeLangyHost()}>
        <LangyProvider>{children}</LangyProvider>
      </LangyHostProvider>
    </RecordingAnalyticsProvider>
  </DesignSystemProvider>
);

beforeEach(() => {
  tracked.events.length = 0;
  sendMessage.mockReset();
  currentDrawerRef.current = undefined;
  useLangyStore.setState({ isOpen: true, activeConversationId: null, draft: "" });
});

afterEach(() => cleanup());

describe("LangySidecar", () => {
  describe("given an empty panel offering suggestions", () => {
    /** @scenario "Telemetry: a question typed in Langy's composer sends langy.asked.question" */
    it("counts a picked suggestion once, as asked from the composer", async () => {
      const user = userEvent.setup();
      render(<LangySidecar />, { wrapper: Wrapper });

      const emptyState = await screen.findByTestId("langy-empty-state");
      const [suggestion] = await within(emptyState).findAllByRole("button");
      await user.click(suggestion as HTMLElement);

      await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
      expect(tracked.events).toEqual([
        {
          boundary: "langy",
          action: "asked",
          name: "question",
          attributes: { surface: "composer" },
        },
      ]);
    });
  });
});
