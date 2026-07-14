/**
 * @vitest-environment jsdom
 *
 * The conversation-context strip distinguishes redacted turn content from a
 * genuinely-absent one: a side whose content a privacy rule hid (the server
 * nulled it but set `inputRedacted` / `outputRedacted`) renders the shared
 * "Redacted" marker, NOT the "(no user message)" / "(no assistant response)"
 * placeholder used when a turn really has no content on that side.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("../../../stores/drawerStore", () => ({
  useDrawerStore: (selector: (s: { viewMode: string }) => unknown) =>
    selector({ viewMode: "summary" }),
}));

vi.mock("../../../hooks/useTraceDrawerNavigation", () => ({
  useTraceDrawerNavigation: () => ({ navigateToTrace: vi.fn() }),
}));

// RedactedInline looks up org permissions for the settings link.
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1" },
    hasPermission: () => false,
  }),
}));

const turnsState = {
  conversationId: "conv_1",
  total: 2,
  position: 2,
  turns: [
    {
      traceId: "trace_prev",
      timestamp: 1,
      name: "prev",
      rootSpanType: null,
      status: "ok",
      // Previous turn: input hidden by a privacy rule, output present.
      input: null,
      output: "earlier answer",
      inputRedacted: true,
      outputRedacted: false,
      inputVisibleTo: "Admins",
      outputVisibleTo: null,
    },
    {
      traceId: "trace_1",
      timestamp: 2,
      name: "curr",
      rootSpanType: null,
      status: "ok",
      input: "current question",
      output: "current answer",
      inputRedacted: false,
      outputRedacted: false,
      inputVisibleTo: null,
      outputVisibleTo: null,
    },
  ],
  previous: {
    traceId: "trace_prev",
    timestamp: 1,
    name: "prev",
    rootSpanType: null,
    status: "ok",
    input: null,
    output: "earlier answer",
    inputRedacted: true,
    outputRedacted: false,
    inputVisibleTo: "Admins",
    outputVisibleTo: null,
  },
  next: null,
  isLoading: false,
};

vi.mock("../../../hooks/useConversationContext", () => ({
  useConversationContext: () => turnsState,
}));

import { ConversationContext } from "../ConversationContext";

function renderStrip() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ConversationContext
        conversationId="conv_1"
        traceId="trace_1"
        collapsed={false}
        onToggleCollapsed={() => undefined}
      />
    </ChakraProvider>,
  );
}

afterEach(cleanup);

describe("Conversation context strip redaction", () => {
  describe("given a previous turn whose input was redacted", () => {
    it("renders the Redacted marker, not the (no user message) placeholder", () => {
      renderStrip();
      expect(screen.getByText("Redacted")).toBeInTheDocument();
      expect(screen.queryByText("(no user message)")).not.toBeInTheDocument();
    });

    it("carries the audience hint so the reader knows who can see it", () => {
      renderStrip();
      expect(screen.getByText(/visible to Admins/i)).toBeInTheDocument();
    });
  });
});
