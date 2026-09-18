/**
 * @vitest-environment jsdom
 *
 * The empty reply row and where it may speak
 * (specs/langy/langy-stop-and-resume.feature).
 *
 * The record keeps every reply. A kickoff turn that ended with nothing to show
 * and was then run again leaves an empty reply between the tour card and the
 * opener, and on a reload it read "No content" above Langy's first message. The
 * row speaks only for the end of the conversation.
 *
 * Boundary mocks only: the project context, `~/utils/api` (the shared inert
 * router plus this file's own history read) and `@ai-sdk/react`. The panel, the
 * tour card, the code access card and the message rendering are real.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PROJECT_ID = "project-demo";
const CONVERSATION_ID = "conv-guided";
const OPENER =
  "Ok, let's set up your agent with LangWatch. Can I access your code?";

/** The history this file's one read serves. */
const state: { messages: unknown[] } = { messages: [] };

const KICKOFF = {
  id: "m-kickoff",
  role: "user" as const,
  parts: [
    {
      type: "guided-onboarding-kickoff",
      path: "llmops",
      paths: ["llmops"],
      tourStatus: "completed",
      orgName: "ACME",
    },
    {
      type: "text",
      text: "Guided onboarding kickoff. Path to set up now: llmops",
    },
  ],
  createdAtMs: 0,
};

/** A settled reply with nothing visible, as a turn that said nothing stores it. */
const EMPTY_REPLY = {
  id: "m-empty",
  role: "assistant" as const,
  parts: [{ type: "text", text: "" }],
  createdAtMs: 1,
};

/** The opener exactly as the control plane stores it. */
const OPENER_REPLY = {
  id: "m-opener",
  role: "assistant" as const,
  parts: [
    {
      type: "tool-say",
      toolCallId: "call_say",
      state: "output-available",
      input: { text: OPENER },
      output: "Said.",
    },
    {
      type: "tool-code_access",
      toolCallId: "call_code_access",
      state: "output-available",
      input: { reason: "wire tracing in", offer_describe: true },
      output: "The code access card is shown to the user.",
    },
    { type: "text", text: "" },
  ],
  createdAtMs: 2,
};

vi.mock("@ai-sdk/react", () => {
  const engine: { messages: unknown[] } = { messages: [] };
  return {
    useChat: () => ({
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
      resumeStream: () => Promise.resolve(),
    }),
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
  const { createTrpcUtils, idleQuery, modelProviderRouter, withFallback } =
    await import("./support/langyApiMock");
  const trpcUtils = createTrpcUtils();

  return {
    api: withFallback({
      langy: withFallback({
        messages: {
          useQuery: () => ({
            ...idleQuery(),
            isSuccess: true,
            data: {
              messages: state.messages,
              lastError: null,
              isTurnInFlight: false,
              inFlightTurnId: null,
              shouldAskFeedback: false,
              eventCursor: null,
              currentTurnId: null,
            },
          }),
        },
        getLocalWorkspace: {
          useQuery: () => ({
            ...idleQuery(),
            isSuccess: true,
            data: {
              connected: false,
              workspace: null,
              skipAllowed: false,
              skipPermissions: false,
              pendingRequest: null,
              requestState: "open",
              codeAccessPreference: null,
            },
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

const opener = () => screen.getByText(OPENER);
const card = () => screen.getByTestId("langy-code-access-card");

describe("where the empty reply row may speak", () => {
  beforeEach(() => {
    useLangyStore.setState({ scopeAnnounced: false });
    useLangyStore.getState().resetForProject(PROJECT_ID);
    useLangyStore.setState({
      turnPhase: "idle",
      backendSawTurnInFlight: false,
    });
  });

  afterEach(cleanup);

  describe("given a tour card, an empty settled reply, then the opener and its card", () => {
    beforeEach(() => {
      state.messages = [KICKOFF, EMPTY_REPLY, OPENER_REPLY];
    });

    /** @scenario "An empty reply with messages after it draws nothing" */
    it("draws no empty reply row anywhere in the conversation", async () => {
      renderOpenPanel();
      await waitFor(() => expect(opener()).toBeTruthy());

      expect(screen.queryByText("No content")).toBeNull();
    });

    it("keeps the tour card, the opener and the code access card, in that order", async () => {
      renderOpenPanel();
      await waitFor(() => expect(opener()).toBeTruthy());

      const tour = screen.getByTestId("guided-tour-card");
      expect(comesBefore(tour, opener())).toBe(true);
      expect(comesBefore(opener(), card())).toBe(true);
    });
  });

  describe("given an empty settled reply as the last message", () => {
    /** @scenario "An empty reply at the end of the conversation still says so" */
    it("says No content", async () => {
      state.messages = [
        {
          id: "m-question",
          role: "user" as const,
          parts: [{ type: "text", text: "which traces are slow?" }],
          createdAtMs: 0,
        },
        EMPTY_REPLY,
      ];

      renderOpenPanel();

      await waitFor(() =>
        expect(screen.getByText("No content")).toBeInTheDocument(),
      );
    });
  });
});
