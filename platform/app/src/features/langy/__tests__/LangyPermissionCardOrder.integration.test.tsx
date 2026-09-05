/**
 * @vitest-environment jsdom
 *
 * Where the permission cards sit in the column (ADR-129,
 * specs/langy/langy-local-permissions.feature).
 *
 * Every card of the conversation was drawn below the whole transcript, so a
 * finished run ended on a settled permission card: the panel scrolled to the
 * bottom and the last thing on screen was a command, with the answer that
 * closed the turn above it and off screen. A settled turn's cards belong
 * inside it, before the message that closed it; a card raised by a turn that
 * is still running stays at the live edge, beside the working line, because
 * that is where the answer it wants is given.
 *
 * Boundary mocks only: the project context, `~/utils/api` (the shared inert
 * router plus this file's own history and local-record reads) and
 * `@ai-sdk/react`. The panel, the cards and the fold are real.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PROJECT_ID = "project-demo";
const CONVERSATION_ID = "conv-local";
const QUESTION = "run the type check";
const COMMAND = "pnpm typecheck";
const ANSWER = "Every type checks out, nothing to fix.";

/** What the two reads this file owns are saying right now. */
const state = {
  version: 0,
  /** Is the fold still holding a turn open for this conversation? */
  turnInFlight: false,
  /** Has the developer answered the card yet? */
  waitStatus: "answered" as "pending" | "answered",
  /** Has the closing answer landed on the transcript? */
  hasAnswer: true,
};
const listeners = new Set<() => void>();

vi.mock("@ai-sdk/react", async () => {
  const React = await import("react");
  const engine: { messages: unknown[] } = { messages: [] };
  return {
    useChat: () => {
      const [, force] = React.useState(0);
      React.useEffect(() => {
        const notify = () => force((n) => n + 1);
        listeners.add(notify);
        return () => {
          listeners.delete(notify);
        };
      }, []);
      return {
        messages: engine.messages,
        status: "ready",
        error: undefined,
        sendMessage: vi.fn(),
        setMessages: (messages: unknown[]) => {
          engine.messages = messages;
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
  const React = await import("react");
  const { createTrpcUtils, idleQuery, modelProviderRouter, withFallback } =
    await import("./support/langyApiMock");

  /** Re-read whichever of this file's two queries is asking. */
  const useLocalState = () => {
    React.useSyncExternalStore(
      (notify: () => void) => {
        listeners.add(notify);
        return () => {
          listeners.delete(notify);
        };
      },
      () => state.version,
      () => state.version,
    );
    return state;
  };

  const trpcUtils = createTrpcUtils();

  return {
    api: withFallback({
      langy: withFallback({
        messages: {
          useQuery: () => {
            const live = useLocalState();
            const turnId = live.turnInFlight ? "turn-live" : null;
            return {
              ...idleQuery(),
              isSuccess: true,
              data: {
                messages: [
                  {
                    id: "m1",
                    role: "user" as const,
                    parts: [{ type: "text", text: QUESTION }],
                    createdAtMs: 0,
                  },
                  ...(live.hasAnswer
                    ? [
                        {
                          id: "m2",
                          role: "assistant" as const,
                          parts: [{ type: "text", text: ANSWER }],
                          createdAtMs: 1,
                        },
                      ]
                    : []),
                ],
                lastError: null,
                isTurnInFlight: live.turnInFlight,
                inFlightTurnId: turnId,
                shouldAskFeedback: false,
                eventCursor: null,
                currentTurnId: turnId,
              },
            };
          },
        },
        localRecord: {
          useQuery: () => {
            const live = useLocalState();
            return {
              ...idleQuery(),
              isSuccess: true,
              data: {
                workspaceConnected: true,
                waits: [
                  {
                    toolCallId: "call-1",
                    waitId: "wait-1",
                    kind: "permission",
                    status: live.waitStatus,
                    expiresAt: 0,
                    callId: "local-1",
                    summary: COMMAND,
                    pattern: "pnpm *",
                    patterns: ["pnpm *"],
                    reason: "Runs the project's own type check",
                    timeoutSeconds: null,
                    skipOffered: false,
                    workspaceName: "acme-app",
                    hostname: "dev-laptop",
                    questions: null,
                    decision:
                      live.waitStatus === "answered" ? "allow_once" : null,
                    answers: null,
                    answeredBy: null,
                    answeredAt: null,
                  },
                ],
              },
            };
          },
        },
        getLocalWorkspace: {
          useQuery: () => ({
            ...idleQuery(),
            data: { skipAllowed: false, skipPermissions: false },
          }),
        },
        modelsAllowed: {
          useQuery: () => ({
            data: { modelsAllowed: null },
            isLoading: false,
            isError: false,
          }),
        },
        onConversationUpdate: { useSubscription: () => undefined },
      }),
      useUtils: () => trpcUtils,
      useContext: () => trpcUtils,
      modelProvider: modelProviderRouter(),
    }),
  };
});

import { LangySidecar } from "../components/LangyPanel";
import { LangyProvider } from "../LangyContext";
import { useLangyStore } from "../stores/langyStore";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>
    <LangyProvider>{children}</LangyProvider>
  </ChakraProvider>
);

function renderOpenPanel() {
  useLangyStore.setState({
    isOpen: true,
    scopeAnnounced: false,
    activeConversationId: CONVERSATION_ID,
    activeConversationScope: {
      userId: null,
      organizationId: null,
      projectId: PROJECT_ID,
    },
  });
  return render(<LangySidecar />, { wrapper: Wrapper });
}

/** True when `first` really is earlier in the document than `second`. */
function comesBefore(first: Element, second: Element): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

const card = () => screen.getByText(COMMAND);
const closingAnswer = () => screen.getByText(ANSWER);

describe("where a permission card sits in the conversation", () => {
  beforeEach(() => {
    state.version = 0;
    state.turnInFlight = false;
    state.waitStatus = "answered";
    state.hasAnswer = true;
    useLangyStore.setState({ scopeAnnounced: false });
    useLangyStore.getState().resetForProject(PROJECT_ID);
    useLangyStore.setState({
      turnPhase: "idle",
      backendSawTurnInFlight: false,
    });
  });

  afterEach(cleanup);

  describe("given a settled turn that raised a card and then answered", () => {
    /** @scenario "A finished turn ends on its answer, not on a card" */
    it("draws the card above the message that closed the turn", async () => {
      renderOpenPanel();
      await waitFor(() => expect(closingAnswer()).toBeTruthy());

      expect(comesBefore(card(), closingAnswer())).toBe(true);
    });

    it("leaves the answer as the last thing in the turn", async () => {
      renderOpenPanel();
      await waitFor(() => expect(closingAnswer()).toBeTruthy());

      // Nothing of the card may follow the answer: coming back to a finished
      // run must read as the answer, not as a command.
      expect(comesBefore(closingAnswer(), card())).toBe(false);
    });
  });

  describe("given a turn that is still running with a card on screen", () => {
    /** @scenario "A card waiting for me stays at the live edge" */
    it("draws the card below the transcript, beside the working line", async () => {
      state.turnInFlight = true;
      state.waitStatus = "pending";
      state.hasAnswer = false;

      renderOpenPanel();
      await waitFor(() => expect(screen.getByText(QUESTION)).toBeTruthy());

      expect(comesBefore(screen.getByText(QUESTION), card())).toBe(true);
    });
  });
});
