/**
 * @vitest-environment jsdom
 */
/**
 * The per-turn steps strip in the conversation view.
 *
 * A Claude Code turn is an agentic loop — model, tool, model, tool, answer — and
 * the thread's two bubbles show only its ends. These pin the two properties that
 * make the strip worth having: it reveals the loop, and it costs nothing until
 * you ask for it (a long thread must not fire a span query per turn).
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUseQuery } = vi.hoisted(() => ({ mockUseQuery: vi.fn() }));

vi.mock("../../../../trace-api", () => ({
  api: { tracesV2: { spansFull: { useQuery: mockUseQuery } } },
}));

vi.mock("../../../../../../behavior/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project_1" } }),
}));

import { TurnSteps, turnHasGenieSteps } from "../turn-steps";

const SPANS = [
  {
    spanId: "llm-1",
    parentSpanId: null,
    name: "claude_code.llm_request",
    type: "llm",
    startTimeMs: 1000,
    endTimeMs: 1800,
    durationMs: 800,
    status: "ok",
    model: "claude-opus-4-8",
    params: {},
    metrics: { promptTokens: 1200, completionTokens: 40, cost: 0.02 },
    events: [],
  },
  {
    spanId: "tool-1",
    parentSpanId: null,
    name: "claude_code.tool",
    type: "tool",
    startTimeMs: 2000,
    endTimeMs: 4400,
    durationMs: 2400,
    status: "ok",
    params: { tool_name: "Bash", full_command: "pnpm test" },
    metrics: {},
    events: [],
  },
];

function renderStrip() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <TurnSteps traceId="trace-1" occurredAtMs={1000} spanCount={2} />
    </ChakraProvider>,
  );
}

describe("TurnSteps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseQuery.mockReturnValue({
      data: SPANS,
      isLoading: false,
      isError: false,
    });
  });

  describe("given a coding-agent turn that ran steps", () => {
    describe("when the strip renders collapsed", () => {
      it("reports how many steps ran without fetching them", () => {
        renderStrip();

        expect(screen.getByText("2 steps ran")).toBeInTheDocument();
        // The whole point: collapsed rows in a long thread cost no query.
        expect(mockUseQuery.mock.calls[0]?.[1]).toMatchObject({
          enabled: false,
        });
      });
    });

    describe("when the strip is opened", () => {
      it("reveals the model call and the tool run", async () => {
        renderStrip();

        await userEvent.click(screen.getByRole("button", { name: /2 steps ran/ }));

        expect(screen.getByText("Bash")).toBeInTheDocument();
        expect(screen.getByText("pnpm test")).toBeInTheDocument();
        expect(screen.getByText(/2\.4s/)).toBeInTheDocument();
      });

      it("fetches the spans only then", async () => {
        renderStrip();
        await userEvent.click(screen.getByRole("button", { name: /2 steps ran/ }));

        const lastCall = mockUseQuery.mock.calls.at(-1);
        expect(lastCall?.[1]).toMatchObject({ enabled: true });
      });
    });
  });

  describe("given a turn with no spans", () => {
    it("renders nothing rather than an empty affordance", () => {
      const { container } = render(
        <ChakraProvider value={defaultSystem}>
          <TurnSteps traceId="trace-1" spanCount={0} />
        </ChakraProvider>,
      );

      expect(container).toBeEmptyDOMElement();
    });
  });
});

describe("turnHasGenieSteps", () => {
  describe("given a routed Genie turn", () => {
    describe("when it carries a step beyond the root", () => {
      it("admits the turn", () => {
        expect(
          turnHasGenieSteps({
            traceName: "databricks_genie.message",
            spanCount: 2,
          }),
        ).toBe(true);
      });
    });

    describe("when the root is its only span", () => {
      it("refuses the turn — the message generated no SQL, so the strip would announce steps and then find none", () => {
        expect(
          turnHasGenieSteps({
            traceName: "databricks_genie.message",
            spanCount: 1,
          }),
        ).toBe(false);
      });
    });
  });

  describe("given a turn that is not a routed Genie message", () => {
    describe("when it carries a foreign trace name", () => {
      it("refuses the turn regardless of span count", () => {
        expect(turnHasGenieSteps({ traceName: "my-app-trace", spanCount: 5 })).toBe(false);
      });
    });

    describe("when it carries no trace name at all", () => {
      it("refuses the turn regardless of span count", () => {
        expect(turnHasGenieSteps({ spanCount: 5 })).toBe(false);
      });
    });
  });
});
