/**
 * The guided tour hands over to Langy: the tour card settles into the kickoff message.
 * @vitest-environment jsdom
 * Spec: specs/langy/langy-guided-onboarding.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PROJECT_ID = "project-demo";

// The auto-resizing textarea reaches for ResizeObserver on mount, which jsdom lacks.
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

/**
 * The chat engine as real state, with a `sendMessage` that appends what it is given: the queued
 * kickoff reaches the transcript through the panel's own send path, not through the test.
 */
interface EngineMessage {
  id: string;
  role: string;
  parts: unknown[];
}
const engine: { messages: EngineMessage[]; version: number; listeners: Set<() => void> } = {
  messages: [],
  version: 0,
  listeners: new Set(),
};
const notifyEngine = () => {
  engine.version++;
  engine.listeners.forEach((notify) => notify());
};

vi.mock("@ai-sdk/react", async () => {
  const React = await import("react");
  return {
    useChat: () => {
      React.useSyncExternalStore(
        (notify: () => void) => {
          engine.listeners.add(notify);
          return () => engine.listeners.delete(notify);
        },
        () => engine.version,
        () => engine.version,
      );
      return {
        messages: engine.messages,
        status: "ready",
        error: undefined,
        sendMessage: async (message: { role: string; parts: unknown[] }) => {
          engine.messages = [...engine.messages, { id: "m-kickoff", ...message }];
          notifyEngine();
        },
        setMessages: (messages: EngineMessage[]) => {
          engine.messages = messages;
          notifyEngine();
        },
        stop: () => undefined,
        clearError: () => undefined,
        regenerate: () => undefined,
      };
    },
  };
});

vi.mock("@langwatch/browser-host/drawer", () => ({
  useDrawer: () => ({ currentDrawer: null }),
}));

vi.mock("../../elements/langy-model-pill.tsx", () => ({
  LangyModelPill: () => <div data-testid="model-pill" />,
}));

const tour = { running: false, replay: vi.fn() };
vi.mock("../../../behavior/use-guided-tour.ts", () => ({
  useGuidedTour: () => ({ useRunning: () => tour.running, useReplay: () => tour.replay }),
}));

vi.mock("../../../../../behavior/langy-api.ts", async () => {
  const { createTrpcUtils, idleQuery, modelProviderRouter, withFallback } =
    await import("../../../__tests__/support/langy-api-mock.ts");
  const trpcUtils = createTrpcUtils();

  const explicitApi: Record<string, unknown> = {
    langy: withFallback({
      list: {
        useInfiniteQuery: () => ({
          ...idleQuery(),
          data: { pages: [{ items: [], nextCursor: null }], pageParams: [] },
          fetchNextPage: () => Promise.resolve(),
          hasNextPage: false,
          isFetchingNextPage: false,
        }),
      },
      modelsAllowed: {
        useQuery: () => ({ data: { modelsAllowed: null }, isLoading: false, isError: false }),
      },
      messages: { useQuery: () => ({ ...idleQuery(), data: undefined, isLoading: false }) },
      stopTurn: { useMutation: () => ({ mutateAsync: () => Promise.resolve() }) },
      onConversationUpdate: { useSubscription: () => undefined },
    }),
    useUtils: () => trpcUtils,
    useContext: () => trpcUtils,
    modelProvider: modelProviderRouter(),
    virtualKeys: { list: { useQuery: () => ({ data: undefined, isLoading: false }) } },
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
import { LangySidecar } from "../langy-panel.tsx";

/** The host port, stubbed for an open panel on a project. Nothing here reads the address bar. */
vi.mock("@langwatch/browser-host/feature-flag", () => ({
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
    <LangyHostProvider value={new FakeLangyHost()}>
      <LangyProvider>{children}</LangyProvider>
    </LangyHostProvider>
  </DesignSystemProvider>
);

const KICKOFF_PART = {
  type: "guided-onboarding-kickoff",
  path: "llmops",
  paths: ["llmops"],
  provider: "OpenAI",
  providerModel: "gpt-5",
  orgName: "ACME",
  tourStatus: "completed",
} as const;

const invitationSelector = '[data-testid="langy-empty-state"]';
const tourCards = () => screen.queryAllByTestId("guided-tour-card");

/** Records whether the new-chat invitation was ever in the document, between any two renders. */
function watchForInvitation() {
  const seen = { invitation: false };
  const look = () => {
    if (document.querySelector(invitationSelector)) seen.invitation = true;
  };
  const observer = new MutationObserver(look);
  observer.observe(document.body, { childList: true, subtree: true });
  look();

  return { seen, stop: () => observer.disconnect() };
}

describe("the tour card settling into the kickoff message", () => {
  beforeEach(() => {
    engine.messages = [];
    engine.version = 0;
    tour.running = false;
    useLangyStore.setState({
      isOpen: true,
      scopeAnnounced: false,
      activeConversationId: null,
      activeConversationScope: { userId: null, organizationId: null, projectId: PROJECT_ID },
    });
    useLangyStore.getState().resetForProject(PROJECT_ID);
  });

  afterEach(() => {
    cleanup();
  });

  describe("given no tour and no kickoff", () => {
    it("shows the invitation, so the watcher below can see one", async () => {
      render(<LangySidecar />, { wrapper: Wrapper });

      await waitFor(() => expect(document.querySelector(invitationSelector)).toBeTruthy());
      expect(tourCards()).toHaveLength(0);
    });
  });

  describe("given the tour has just ended and the kickoff is queued", () => {
    describe("when the kickoff message lands in the conversation", () => {
      /** @scenario The tour card settles into the kickoff message without a flash */
      it("shows exactly one tour card and never the empty state's invitation", async () => {
        tour.running = true;
        render(<LangySidecar />, { wrapper: Wrapper });
        const watch = watchForInvitation();
        await waitFor(() => expect(tourCards()).toHaveLength(1));

        // The tour ends: the kickoff waits to send, so the card settles in the same place.
        tour.running = false;
        act(() => {
          useLangyStore.getState().queueGuidedKickoff({
            brief: "Guided onboarding kickoff.\nPath: llmops",
            parts: [
              KICKOFF_PART,
              { type: "text", text: "Guided onboarding kickoff.\nPath: llmops" },
            ],
          });
        });
        await waitFor(() => expect(engine.messages).toHaveLength(1));
        await waitFor(() => expect(useLangyStore.getState().pendingKickoff).toBeNull());
        await waitFor(() => expect(screen.getByText("Guided tour")).toBeTruthy());

        watch.stop();
        expect(tourCards()).toHaveLength(1);
        expect(watch.seen.invitation).toBe(false);
        expect(document.querySelector(invitationSelector)).toBeNull();
      });
    });
  });
});
