/**
 * @vitest-environment jsdom
 *
 * The tour card before the kickoff message exists.
 *
 * The guided tour runs before Langy has anything to say: the kickoff user
 * message, and so the card that renders it, only exists once the tour hands
 * over. The panel used to spend the whole tour on the empty state's invitation
 * ("Hey, I'm Langy!" plus starter suggestions), then swap in the card. This pins
 * that the tour card is there in its in-progress state for the whole tour and
 * that the kickoff message takes over without the invitation showing in between.
 *
 * Spec: specs/langy/langy-guided-onboarding.feature
 *
 * Boundary mocks only: the project context, `~/utils/api` (an inert tRPC
 * surface with a resolved Langy model, so the kickoff can drain) and
 * `@ai-sdk/react`, whose `sendMessage` lands the message the way the real
 * engine does. The panel, both stores and the card are real.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PROJECT_ID = "project-demo";
const ORGANIZATION_ID = "org-demo";

/**
 * The chat engine, modelled as real state: `sendMessage` appends the user
 * message, which is exactly how the kickoff message comes to exist.
 */
interface EngineMessage {
  id: string;
  role: string;
  parts: unknown[];
}
const engine: {
  messages: EngineMessage[];
  version: number;
  listeners: Set<() => void>;
} = { messages: [], version: 0, listeners: new Set() };
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
        sendMessage: (message: { role: string; parts: unknown[] }) => {
          engine.messages = [
            ...engine.messages,
            { id: `m-${engine.messages.length + 1}`, ...message },
          ];
          notifyEngine();
          return Promise.resolve();
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

vi.mock("ai", () => ({
  DefaultChatTransport: class {
    constructor(public opts: unknown) {}
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: PROJECT_ID, slug: "demo" },
    organization: { id: ORGANIZATION_ID },
  }),
}));

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: false, isLoading: false }),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

vi.mock("~/utils/trpcError", () => ({
  isHandledByGlobalHandler: () => false,
}));

vi.mock("~/components/Markdown", () => ({
  Markdown: ({ children }: { children: string }) => <span>{children}</span>,
}));

vi.mock("@paper-design/shaders-react", () => ({
  MeshGradient: () => null,
}));

vi.mock("~/utils/api", async () => {
  const { createTrpcUtils, idleQuery, modelProviderRouter, withFallback } =
    await import("./support/langyApiMock");
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
        useQuery: () => ({
          data: { modelsAllowed: null },
          isLoading: false,
          isError: false,
        }),
      },
      messages: { useQuery: () => idleQuery() },
      stopTurn: {
        useMutation: () => ({ mutateAsync: () => Promise.resolve() }),
      },
      onConversationUpdate: { useSubscription: () => undefined },
    }),
    useUtils: () => trpcUtils,
    useContext: () => trpcUtils,
    modelProvider: modelProviderRouter(),
    virtualKeys: {
      list: { useQuery: () => ({ data: undefined, isLoading: false }) },
    },
    github: {
      getConnectionStatus: {
        useQuery: () => ({ data: undefined, isLoading: false, isError: true }),
      },
      disconnect: {
        useMutation: () => ({ mutate: () => undefined, isPending: false }),
      },
    },
  };
  return { api: withFallback(explicitApi) };
});

import { useGuidedTourStore } from "~/features/guided-onboarding/tour/guidedTourStore";
import { LangySidecar } from "../components/LangyPanel";
import { LangyProvider } from "../LangyContext";
import { useLangyStore } from "../stores/langyStore";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>
    <LangyProvider>{children}</LangyProvider>
  </ChakraProvider>
);

/** Mount the way the takeover does: the panel is open on no conversation. */
function renderFreshPanel() {
  useLangyStore.setState({
    isOpen: true,
    scopeAnnounced: false,
    activeConversationId: null,
    activeConversationScope: {
      userId: null,
      organizationId: null,
      projectId: PROJECT_ID,
    },
  });
  return render(<LangySidecar />, { wrapper: Wrapper });
}

const invitation = () => screen.queryByTestId("langy-empty-state");
const tourCards = () => screen.queryAllByTestId("guided-tour-card");

describe("the panel while the guided tour runs", () => {
  beforeEach(() => {
    engine.messages = [];
    engine.version = 0;
    useLangyStore.setState({ scopeAnnounced: false });
    useLangyStore.getState().resetForProject(PROJECT_ID);
    useGuidedTourStore.setState({ running: true, path: "llmops" });
  });

  afterEach(() => {
    cleanup();
    useGuidedTourStore.setState({ running: false, path: null });
  });

  describe("given the tour is running and no conversation exists yet", () => {
    /** @scenario "The panel shows the tour in progress before the kickoff exists" */
    it("shows the tour card in progress instead of the invitation", async () => {
      renderFreshPanel();

      await waitFor(() =>
        expect(screen.getByText("Doing guided tour")).toBeDefined(),
      );
      expect(tourCards()).toHaveLength(1);
      expect(invitation()).toBeNull();
    });
  });

  describe("when the tour ends and the kickoff it queued lands", () => {
    /** @scenario "The tour card settles into the kickoff message without a flash" */
    it("keeps one tour card throughout and never shows the invitation", async () => {
      renderFreshPanel();
      await waitFor(() =>
        expect(screen.getByText("Doing guided tour")).toBeDefined(),
      );

      // The tour ends and, as its end callback does, queues the kickoff.
      act(() => {
        useGuidedTourStore.setState({ running: false });
        useLangyStore.getState().queueGuidedKickoff({
          path: "llmops",
          paths: ["llmops"],
          provider: "OpenAI",
          providerModel: "gpt-5",
          orgName: "ACME",
          firstName: "Ada",
          tourStatus: "completed",
          conversationId: null,
        });
      });

      // The panel drains the kickoff into the engine: the message now exists.
      await waitFor(() => expect(engine.messages).toHaveLength(1));
      await waitFor(() =>
        expect(screen.getByText("Guided tour")).toBeDefined(),
      );

      expect(tourCards()).toHaveLength(1);
      expect(screen.queryByText("Doing guided tour")).toBeNull();
      expect(invitation()).toBeNull();
      expect(useLangyStore.getState().pendingKickoff).toBeNull();
    });
  });

  describe("given no tour is running and nothing is queued", () => {
    // A genuinely new chat is what the invitation is FOR.
    it("offers the invitation, with no tour card", async () => {
      useGuidedTourStore.setState({ running: false, path: null });
      renderFreshPanel();

      await waitFor(() => expect(invitation()).toBeTruthy());
      expect(tourCards()).toHaveLength(0);
    });
  });
});
