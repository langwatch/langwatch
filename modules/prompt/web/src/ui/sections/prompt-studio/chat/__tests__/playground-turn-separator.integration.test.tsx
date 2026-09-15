/**
 * @vitest-environment jsdom
 *
 * The rule that opens a turn in the playground's conversation, and the trace
 * affordance on it.
 *
 * @see specs/prompts/playground-conversation.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PromptHostProvider } from "../../../../../model/prompt-host.ts";
import { FakePromptHost } from "../../../../../testing.tsx";
import { PlaygroundTurnSeparator } from "../playground-turn-separator.tsx";

const traceQuery = vi.hoisted(() => vi.fn());

vi.mock("../../../../../behavior/prompt-api.ts", () => ({
  promptApi: {
    traces: { getById: { useQuery: (...args: unknown[]) => traceQuery(...args) } },
  },
}));

const openPlatformDrawer = vi.fn();

function renderSeparator() {
  const host = new FakePromptHost();
  host.openPlatformDrawer = openPlatformDrawer;

  return render(
    <ChakraProvider value={defaultSystem}>
      <PromptHostProvider value={host}>
        <PlaygroundTurnSeparator index={1} traceId="trace-1" live />
      </PromptHostProvider>
    </ChakraProvider>,
  );
}

describe("<PlaygroundTurnSeparator />", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => cleanup());

  describe("given the turn's trace has landed", () => {
    /** @scenario Each completed turn offers its trace */
    it("labels the turn and opens the trace when the separator is activated", async () => {
      traceQuery.mockReturnValue({ data: { trace_id: "trace-1" }, isError: false });

      renderSeparator();

      expect(screen.getByText("Turn 1")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "View trace for turn 1" }));

      expect(openPlatformDrawer).toHaveBeenCalledWith({
        drawer: "traceV2Details",
        params: { traceId: "trace-1" },
      });
    });
  });

  describe("given the turn's trace has not landed yet", () => {
    /** @scenario A turn whose trace has not landed yet offers no trace affordance */
    it("leaves the separator a plain rule", () => {
      traceQuery.mockReturnValue({ data: undefined, isError: false });

      renderSeparator();

      expect(screen.getByText("Turn 1")).toBeInTheDocument();
      // Advertising a trace that 404s is worse than waiting a beat for one
      // that opens, so nothing is offered until the trace is really there.
      expect(screen.queryByRole("button", { name: /View trace/ })).toBeNull();
      expect(screen.queryByText("View trace")).toBeNull();
    });
  });
});
