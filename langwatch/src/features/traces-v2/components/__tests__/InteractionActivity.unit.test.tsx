/**
 * @vitest-environment jsdom
 */
/**
 * What a coding-agent interaction did, in the order it did it.
 *
 * The row a chat-shaped trace shows — prompt in, reply out — cannot tell
 * "answered in one shot" apart from "ran forty tools, got cut off, cost $4".
 * These pin the two properties that make the strip worth having: it shows the
 * SEQUENCE (not a tally), and a failure reads where it happened.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { deriveCodeAgentActivity } from "../../hooks/useCodeAgentActivity";
import { InteractionActivity } from "../InteractionActivity";

function steps(pairs: [number, string][]): Record<string, string> {
  return { "langwatch.code_agent.steps": JSON.stringify(pairs) };
}

function renderActivity(attributes: Record<string, string>) {
  const activity = deriveCodeAgentActivity(attributes);
  return render(
    <ChakraProvider value={defaultSystem}>
      <InteractionActivity activity={activity} />
    </ChakraProvider>,
  );
}

const READ_TEST_FIX_RERUN: Record<string, string> = {
  ...steps([
    [1, "Read"],
    [2, "Read"],
    [3, "Bash"],
    [4, "Edit"],
    [5, "Bash"],
  ]),
  "langwatch.code_agent.model_calls": "3",
  "langwatch.code_agent.tool_calls": "5",
};

describe("InteractionActivity", () => {
  describe("given an interaction that read, tested, fixed and re-ran", () => {
    it("shows the steps in the order they happened", () => {
      renderActivity(READ_TEST_FIX_RERUN);

      // A tally would say "Bash 2, Read 2, Edit 1" and lose the story. The two
      // opening reads batch; the trailing Bash stays its own beat because it
      // came after the Edit.
      const labels = screen
        .getAllByText(/^(Read|Bash|Edit)/)
        .map((el) => el.textContent);
      expect(labels).toEqual(["Read ×2", "Bash", "Edit", "Bash"]);
    });

    it("summarises the work in plain language for screen readers", () => {
      renderActivity(READ_TEST_FIX_RERUN);

      expect(
        screen.getByLabelText("3 model calls, 5 tool runs"),
      ).toBeInTheDocument();
    });
  });

  describe("given a step that failed", () => {
    it("marks it in place rather than hoisting it to the front", () => {
      renderActivity({
        ...steps([
          [1, "Read"],
          [2, "Bash!"],
          [3, "Edit"],
        ]),
        "langwatch.code_agent.tool_calls": "3",
        "langwatch.code_agent.failed_tools": "1",
      });

      // A command that failed BEFORE an edit means something different from one
      // that failed after, so the sequence must be preserved.
      const labels = screen
        .getAllByText(/^(Read|Bash|Edit)/)
        .map((el) => el.textContent);
      expect(labels).toEqual(["Read", "Bash", "Edit"]);
    });
  });

  describe("given more steps than fit on one line", () => {
    it("collapses the tail into a +N rather than wrapping the row", () => {
      // Distinct tools, so nothing batches away and the strip really does
      // overflow. (A run of the SAME tool would collapse into one "×N" step
      // instead, which is the point of batching.)
      const tools = ["Read", "Bash", "Edit", "Grep", "Write", "Task", "Glob"];
      const many: [number, string][] = tools.map((name, i) => [i, name]);
      renderActivity({
        ...steps(many),
        "langwatch.code_agent.tool_calls": String(tools.length),
      });

      // The trace list is virtualized on a fixed row height, so the cell must
      // never grow taller. 7 distinct steps, 6 inline.
      expect(screen.getByText("+1")).toBeInTheDocument();
    });
  });

  describe("given a cut-off reply", () => {
    it("says so, since the final text would otherwise read as an answer", () => {
      renderActivity({
        ...steps([[1, "Read"]]),
        "langwatch.code_agent.tool_calls": "1",
        "langwatch.code_agent.truncated": "true",
      });

      expect(screen.getByText("Cut off")).toBeInTheDocument();
    });
  });

  describe("given a trace that is not a coding-agent interaction", () => {
    it("renders nothing at all", () => {
      const { container } = renderActivity({});

      expect(container).toBeEmptyDOMElement();
    });
  });
});

describe("batching runs of the same tool", () => {
  it("collapses a back-to-back run into one step with a count", () => {
    renderActivity({
      ...steps([
        [1, "Read"],
        [2, "Read"],
        [3, "Read"],
        [4, "Bash"],
      ]),
      "langwatch.code_agent.tool_calls": "4",
    });

    // Eight reads in a row is one thing done eight times; spelling it out buries
    // the shape of the interaction under repetition.
    expect(screen.getByText(/×3/)).toBeInTheDocument();
  });

  it("only batches ADJACENT runs, so a return to a tool stays its own beat", () => {
    renderActivity({
      ...steps([
        [1, "Read"],
        [2, "Read"],
        [3, "Bash"],
        [4, "Read"],
      ]),
      "langwatch.code_agent.tool_calls": "4",
    });

    // It checked, ran, and checked again — merging the trailing Read back into
    // the first would erase that story.
    const labels = screen
      .getAllByText(/^(Read|Bash)/)
      .map((el) => el.textContent);
    expect(labels).toEqual(["Read ×2", "Bash", "Read"]);
  });
});
