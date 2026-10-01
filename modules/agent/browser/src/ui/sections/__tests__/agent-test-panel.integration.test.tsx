/**
 * @vitest-environment jsdom
 * @see specs/agents/agent-test-run.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const turns: unknown[] = [];

vi.mock("../../../behavior/agent-api.ts", () => ({
  agentApi: {
    agents: {
      testTurn: {
        useMutation: () => ({
          mutate: (input: unknown) => turns.push(input),
          data: undefined,
          error: null,
          isPending: false,
        }),
      },
    },
  },
}));

vi.mock("../../../behavior/lent-parameter-line-field.tsx", async () => {
  const { createElement } = await import("react");
  return {
    ParameterLineField: (props: {
      value: string;
      onChange: (line: string) => void;
      testId: string;
    }) =>
      createElement("input", {
        "data-testid": props.testId,
        value: props.value,
        onChange: (event: { target: { value: string } }) => props.onChange(event.target.value),
      }),
  };
});

// This package runs without isolation: start from fresh modules, and leave none behind.
vi.resetModules();
afterAll(() => {
  vi.resetModules();
});
const { AgentTestPanel } = await import("../agent-test-panel.tsx");

function renderPanel() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <AgentTestPanel
        agentId="agent_1"
        projectId="project_1"
        parameters={[
          { name: "model", type: "string", options: ["gpt-4", "gpt-5"], defaultValue: "gpt-4" },
        ]}
      />
    </ChakraProvider>,
  );
}

afterEach(() => {
  cleanup();
  turns.length = 0;
});

describe("the agent test panel of an agent that declares a parameter", () => {
  describe("when the panel is opened", () => {
    /** @scenario "The connected agent drawer test turn takes parameter overrides" */
    it("offers a parameters field and reads ping in the message", () => {
      renderPanel();

      expect(screen.getByTestId("agent-test-parameters")).toBeInTheDocument();
      expect(screen.getByTestId("agent-test-message")).toHaveValue("ping");
    });
  });

  describe("when the test starts with a value typed", () => {
    /** @scenario "The connected agent drawer test turn takes parameter overrides" */
    it("sends the turn with that value", async () => {
      renderPanel();
      const user = userEvent.setup();

      await user.type(screen.getByTestId("agent-test-parameters"), "model=gpt-5");
      await user.click(screen.getByTestId("agent-test-run"));

      expect(turns).toEqual([
        { id: "agent_1", projectId: "project_1", message: "ping", params: { model: "gpt-5" } },
      ]);
    });
  });

  describe("when the test starts with the field empty", () => {
    /** @scenario "The connected agent drawer test turn takes parameter overrides" */
    it("sends the turn with no params key, so the code default applies", async () => {
      renderPanel();
      const user = userEvent.setup();

      await user.click(screen.getByTestId("agent-test-run"));

      expect(turns).toEqual([{ id: "agent_1", projectId: "project_1", message: "ping" }]);
    });
  });
});
