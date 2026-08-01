/**
 * @vitest-environment jsdom
 *
 * Per-turn translate-to-English in the conversation view
 * (specs/traces-v2/message-translation.feature). Renders the real
 * ChatTurnRow → TurnSeparator → TurnActionRow chain with the real
 * useTextTranslation hook; only the tRPC boundary is mocked.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("../../scenarioRoles", async () => {
  const actual = await vi.importActual<typeof import("../../scenarioRoles")>(
    "../../scenarioRoles",
  );
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

vi.mock("~/components/Markdown", () => ({
  Markdown: ({ children }: { children: string }) => <span>{children}</span>,
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1" },
    // Viewer without annotations:manage — the Translate action must
    // still show (it is not an annotation capability).
    hasPermission: () => false,
  }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: vi.fn() }),
}));

vi.mock("~/components/me/usePersonalFeatureGate", () => ({
  usePersonalFeatureGate: () => ({
    requestEnable: async () => true,
    dialogState: null,
  }),
}));

vi.mock("~/components/me/PersonalFeatureGateDialog", () => ({
  PersonalFeatureGateDialog: () => null,
}));

const translateMock = vi.fn(
  async ({ textToTranslate }: { textToTranslate: string }) => ({
    translation: `EN: ${textToTranslate}`,
  }),
);

vi.mock("~/utils/api", () => ({
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
    events: [],
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

afterEach(() => {
  cleanup();
  translateMock.mockClear();
});

describe("ChatTurnRow translate action", () => {
  describe("when the user clicks Translate on a turn", () => {
    it("swaps both bubbles to the translated text", async () => {
      const user = userEvent.setup();
      renderRow({ user: "Hej, hur mår du?", assistant: "Jag mår bra!" });

      await user.click(screen.getByRole("button", { name: /translate/i }));

      await waitFor(() => {
        expect(screen.getByText("EN: Hej, hur mår du?")).toBeInTheDocument();
      });
      expect(screen.getByText("EN: Jag mår bra!")).toBeInTheDocument();
      expect(translateMock).toHaveBeenCalledTimes(2);
    });

    it("shows the action even without annotations:manage", () => {
      renderRow({ user: "hello", assistant: "world" });
      expect(
        screen.getByRole("button", { name: /translate/i }),
      ).toBeInTheDocument();
      // The annotation trio stays hidden for this viewer.
      expect(
        screen.queryByRole("button", { name: /annotate/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("when the user toggles a translated turn back", () => {
    it("restores the originals without a second network request", async () => {
      const user = userEvent.setup();
      renderRow({ user: "Hej!", assistant: "Hallå!" });

      await user.click(screen.getByRole("button", { name: /translate/i }));
      await waitFor(() => {
        expect(screen.getByText("EN: Hej!")).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /original/i }));
      expect(screen.getByText("Hej!")).toBeInTheDocument();
      expect(screen.queryByText("EN: Hej!")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /translate/i }));
      await waitFor(() => {
        expect(screen.getByText("EN: Hej!")).toBeInTheDocument();
      });
      // First activation fired one request per bubble; re-activation hits
      // the cache.
      expect(translateMock).toHaveBeenCalledTimes(2);
    });
  });
});
