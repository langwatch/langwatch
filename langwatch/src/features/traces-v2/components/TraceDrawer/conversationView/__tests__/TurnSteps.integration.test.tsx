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

vi.mock("~/utils/api", () => ({
  api: { tracesV2: { spansFull: { useQuery: mockUseQuery } } },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project_1" } }),
}));

import { TurnSteps } from "../TurnSteps";

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
    it("reports how many steps ran without fetching them", () => {
      renderStrip();

      expect(screen.getByText("2 steps ran")).toBeInTheDocument();
      // The whole point: collapsed rows in a long thread cost no query.
      expect(mockUseQuery.mock.calls[0]?.[1]).toMatchObject({ enabled: false });
    });

    it("reveals the model call and the tool run once opened", async () => {
      renderStrip();

      await userEvent.click(
        screen.getByRole("button", { name: /2 steps ran/ }),
      );

      expect(screen.getByText("Bash")).toBeInTheDocument();
      expect(screen.getByText("pnpm test")).toBeInTheDocument();
      expect(screen.getByText(/2\.4s/)).toBeInTheDocument();
    });

    it("fetches the spans only after it is opened", async () => {
      renderStrip();
      await userEvent.click(
        screen.getByRole("button", { name: /2 steps ran/ }),
      );

      const lastCall = mockUseQuery.mock.calls.at(-1);
      expect(lastCall?.[1]).toMatchObject({ enabled: true });
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
