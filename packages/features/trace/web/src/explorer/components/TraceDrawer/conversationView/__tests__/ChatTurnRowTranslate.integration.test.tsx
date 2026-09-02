/**
 * @vitest-environment jsdom
 *
 * Per-message translate-to-English in the conversation view
 * (specs/traces-v2/message-translation.feature). Renders the real
 * ChatTurnRow → message → MessageAnnotateCluster chain with the real
 * useTextTranslation hook; only the tRPC boundary is mocked.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("../../scenarioRoles", async () => {
  const actual =
    await vi.importActual<typeof import("../../scenarioRoles")>("../../scenarioRoles");
  return { ...actual, useIsScenarioRole: () => false };
});

vi.mock("../expandContext", () => ({
  useConversationExpand: () => ({
    isExpandable: false,
    shouldExpandAll: false,
  }),
  ConversationExpandContext: {
    Provider: ({ children }: { children: unknown }) => children,
  },
}));

vi.mock("../../../../../components/Markdown", () => ({
  Markdown: ({ children }: { children: string }) => <span>{children}</span>,
}));

vi.mock("../../../../../behavior/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1" },
    // Viewer without annotations:manage — the Translate action must
    // still show (it is not an annotation capability).
    hasPermission: () => false,
  }),
}));

vi.mock("../../../../../behavior/use-drawer", () => ({
  useDrawer: () => ({ openDrawer: vi.fn() }),
}));

vi.mock("../../../../../components/me/usePersonalFeatureGate", () => ({
  usePersonalFeatureGate: () => ({
    requestEnable: async () => true,
    dialogState: null,
  }),
}));

vi.mock("../../../../../components/me/PersonalFeatureGateDialog", () => ({
  PersonalFeatureGateDialog: () => null,
}));

const translateMock = vi.fn(async ({ textToTranslate }: { textToTranslate: string }) => ({
  translation: `EN: ${textToTranslate}`,
}));

vi.mock("../../../../../behavior/trace-api", () => ({
  api: {
    translate: {
      translate: {
        useMutation: () => ({
          mutateAsync: translateMock,
          isLoading: false,
        }),
      },
    },
    annotation: {
      getByTraceId: {
        useQuery: () => ({ data: [] }),
      },
    },
  },
}));

import type { TraceListItem } from "../../../../types/trace";
import { NO_TRACE_EVENTS } from "../../../../types/trace";
import { ChatTurnRow } from "../ChatTurnRow";

function turn(over: Partial<TraceListItem>): TraceListItem {
  return {
    traceId: "t1",
    timestamp: 1,
    name: "turn",
    serviceName: "svc",
    durationMs: 10,
    totalCost: 0,
    nonBilledCost: 0,
    totalTokens: 0,
    models: [],
    labels: [],
    status: "ok",
    spanCount: 1,
    sizeBytes: 0,
    input: null,
    output: null,
    origin: "application",
    evaluations: [],
    events: NO_TRACE_EVENTS,
    ...over,
  };
}

function renderRow(texts: { user: string; assistant: string }) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ChatTurnRow
        layout="thread"
        turn={turn({})}
        userText={texts.user}
        assistantText={texts.assistant}
        assistantReasoning=""
        gapSecs={0}
        showGap={false}
        index={1}
        isCurrent={false}
        onSelect={() => undefined}
      />
    </ChakraProvider>,
  );
}

const CLUSTER_LABEL = {
  message: "Message actions",
  reply: "Reply actions",
} as const;

const cluster = (side: "message" | "reply") =>
  screen.getByRole("group", { name: CLUSTER_LABEL[side] });

const translateOn = (side: "message" | "reply") =>
  within(cluster(side)).getByRole("button", {
    name: /translate|original/i,
  });

afterEach(() => {
  cleanup();
  translateMock.mockClear();
});

describe("given a turn whose messages the reader cannot read", () => {
  describe("when the reader translates the user message", () => {
    /** @scenario "Each message translates independently" */
    it("translates that message and leaves the reply as it was written", async () => {
      const user = userEvent.setup();
      renderRow({ user: "Hej, hur mår du?", assistant: "Jag mår bra!" });

      await user.click(translateOn("message"));

      await waitFor(() => {
        expect(screen.getByText("EN: Hej, hur mår du?")).toBeInTheDocument();
      });
      expect(screen.getByText("Jag mår bra!")).toBeInTheDocument();
      expect(screen.queryByText("EN: Jag mår bra!")).not.toBeInTheDocument();
      expect(translateMock).toHaveBeenCalledTimes(1);
    });

    /** @scenario "Each message translates independently" */
    it("leaves the reply's own action still offering to translate it", async () => {
      const user = userEvent.setup();
      renderRow({ user: "Hej!", assistant: "Hallå!" });

      await user.click(translateOn("message"));
      await waitFor(() => {
        expect(screen.getByText("EN: Hej!")).toBeInTheDocument();
      });

      expect(translateOn("reply")).toHaveTextContent("Translate");
      expect(translateOn("message")).toHaveTextContent("Original");
    });
  });

  describe("when a reader who may not write annotations hovers a message", () => {
    /** @scenario "Translate does not require annotation permissions" */
    it("offers translating it and nothing else", () => {
      renderRow({ user: "hello", assistant: "world" });

      expect(translateOn("message")).toBeInTheDocument();
      expect(
        within(cluster("message"))
          .getAllByRole("button")
          .map((button) => button.textContent),
      ).toEqual(["Translate"]);
      expect(
        screen.queryByRole("button", { name: /^Annotate this/ }),
      ).not.toBeInTheDocument();
    });
  });
});

describe("given a message showing its translation", () => {
  describe("when the reader toggles it back", () => {
    /** @scenario "Toggling a translated message back" */
    it("restores the original without a second request", async () => {
      const user = userEvent.setup();
      renderRow({ user: "Hej!", assistant: "Hallå!" });

      await user.click(translateOn("message"));
      await waitFor(() => {
        expect(screen.getByText("EN: Hej!")).toBeInTheDocument();
      });

      await user.click(translateOn("message"));
      expect(screen.getByText("Hej!")).toBeInTheDocument();
      expect(screen.queryByText("EN: Hej!")).not.toBeInTheDocument();

      await user.click(translateOn("message"));
      await waitFor(() => {
        expect(screen.getByText("EN: Hej!")).toBeInTheDocument();
      });
      // The first activation fired the one request this message needed;
      // re-activating reads the cache.
      expect(translateMock).toHaveBeenCalledTimes(1);
    });
  });
});
