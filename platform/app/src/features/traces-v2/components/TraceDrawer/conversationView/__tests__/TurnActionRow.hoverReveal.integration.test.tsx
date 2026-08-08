/**
 * @vitest-environment jsdom
 *
 * How the per-turn actions come and go. They stay out of the way until the
 * reader's pointer is on the turn, and when they arrive they arrive on a
 * surface of their own so the ledger underneath is covered rather than read
 * through. jsdom has no `:hover`, so the reveal is exercised through the
 * `data-hover` half of Chakra's group condition.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
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

vi.mock("~/utils/api", () => ({
  api: {
    translate: {
      translate: {
        useMutation: () => ({ mutateAsync: vi.fn(), isLoading: false }),
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

function turn(): TraceListItem {
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
  };
}

function renderRow() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ChatTurnRow
        layout="thread"
        turn={turn()}
        userText="a question"
        assistantText="an answer"
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

/** The separator the actions belong to, and the hover group they answer. */
function separator(): HTMLElement {
  return screen.getByText("Turn 1").closest('[role="group"]') as HTMLElement;
}

/** The action cluster itself, found through one of the actions it holds. */
function actionRow(): HTMLElement {
  return screen.getByRole("button", { name: /translate/i })
    .parentElement as HTMLElement;
}

afterEach(cleanup);

describe("Turn action row", () => {
  describe("given the reader's pointer is elsewhere", () => {
    /** @scenario "The turn's actions stay away until the pointer is on the turn" */
    it("keeps the actions out of the way", () => {
      renderRow();

      expect(getComputedStyle(actionRow()).opacity).toBe("0");
    });
  });

  describe("when the reader's pointer is on the turn", () => {
    /**
     * The reveal resolves against `.group` on the separator, not against its
     * role. Naming only the role left the actions at opacity 0 for every
     * reader, on every turn.
     *
     * @scenario "The turn's actions arrive when the pointer is on the turn"
     */
    it("reveals the actions", () => {
      renderRow();
      separator().setAttribute("data-hover", "");

      expect(getComputedStyle(actionRow()).opacity).toBe("1");
    });

    /** @scenario "The turn's actions arrive when the pointer is on the turn" */
    it("brings them in on a surface of their own", () => {
      renderRow();
      separator().setAttribute("data-hover", "");

      const surface = getComputedStyle(actionRow());
      // Opaque, because the actions land over the turn ledger and reading one
      // through the other leaves both illegible.
      expect(surface.backgroundColor).not.toBe("");
      expect(surface.backgroundColor).not.toBe("transparent");
      expect(surface.borderRadius).not.toBe("");
    });
  });
});
