import { describe, expect, it } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  CLOSING_LINE,
  CLOSING_LINE_PUSHBACK,
  closingLineRefusal,
  COMPLETE_PATH_COMMAND,
  type TurnCall,
} from "../guided-turn-end.js";
import {
  createSayExtension,
  EMPTY_SAY_PUSHBACK,
  renderSaid,
  REPEATED_LINE_PUSHBACK,
  repeatedLineRefusal,
  SAID_RESULT,
  type SayRefusal,
  SAY_TOOL_NAME,
} from "./say.js";

type RegisteredTool = {
  name: string;
  label: string;
  description: string;
  execute: (
    toolCallId: string,
    params: { text: string },
    signal?: AbortSignal,
  ) => Promise<{ content: Array<{ type: string; text: string }> }>;
};

function registerSay(refuse?: SayRefusal): RegisteredTool {
  let registered: RegisteredTool | undefined;
  const pi = {
    registerTool: (tool: RegisteredTool) => {
      registered = tool;
    },
  };
  const extension = createSayExtension({ refuse }) as unknown as {
    factory: (pi: ExtensionAPI) => void;
  };
  extension.factory(pi as unknown as ExtensionAPI);
  if (!registered) throw new Error("say did not register");
  return registered;
}

describe("the say tool", () => {
  /** @scenario "A line said with the say tool is drawn where the call happened" */
  it("registers under the name the panel and the manager know", () => {
    const tool = registerSay();
    expect(tool.name).toBe(SAY_TOOL_NAME);
    expect(tool.name).toBe("say");
    expect(tool.label).toBe("Say");
    // The description is what makes the model use it at the moment, not at
    // the end of the turn.
    expect(tool.description).toContain("in place");
    expect(tool.description).toContain("Never repeat in the reply");
  });

  /** @scenario "A line said with the say tool is drawn where the call happened" */
  it("answers with a short result once the line is on screen", async () => {
    const tool = registerSay();
    const result = await tool.execute("call_1", {
      text: "Running it against your agent now.",
    });
    expect(result.content).toEqual([{ type: "text", text: SAID_RESULT }]);
  });

  /** @scenario "A line said with the say tool is drawn where the call happened" */
  it("refuses an empty line instead of drawing nothing", async () => {
    const tool = registerSay();
    const result = await tool.execute("call_2", { text: "   " });
    expect(result.content).toEqual([{ type: "text", text: EMPTY_SAY_PUSHBACK }]);
    expect(renderSaid(undefined)).toBe(EMPTY_SAY_PUSHBACK);
    expect(renderSaid("All ready!")).toBe(SAID_RESULT);
  });

  const completePath = (exitCode: number): TurnCall => ({
    name: "local_bash",
    input: { command: `${COMPLETE_PATH_COMMAND} llmops` },
    isError: false,
    output: `exit code: ${exitCode}\n\nstdout:\n`,
  });

  describe("given the closing line rule of the guided path", () => {
    const withCalls = (calls: TurnCall[]) => registerSay((text) => closingLineRefusal({ text, calls }));

    /** @scenario "The closing line is refused before complete-path" */
    it("answers the closing line with the rule while the command has not run, and draws nothing", async () => {
      const tool = withCalls([]);
      await expect(tool.execute("call_3", { text: CLOSING_LINE })).rejects.toThrow(
        CLOSING_LINE_PUSHBACK,
      );
      expect(CLOSING_LINE_PUSHBACK).toContain("the closing line comes after `langwatch onboarding complete-path`");
      expect(CLOSING_LINE_PUSHBACK).toContain("the path is not done");
      // A line that carries the closing line with words around it is the same line early.
      await expect(
        tool.execute("call_4", { text: `Done with the tests. ${CLOSING_LINE}` }),
      ).rejects.toThrow(CLOSING_LINE_PUSHBACK);
      // A failed complete-path did not close the path.
      await expect(
        withCalls([completePath(1)]).execute("call_5", { text: CLOSING_LINE }),
      ).rejects.toThrow(CLOSING_LINE_PUSHBACK);
    });

    /** @scenario "The closing line is refused before complete-path" */
    it("says the closing line once the command ran clean, and every other line as before", async () => {
      const after = withCalls([completePath(0)]);
      const said = await after.execute("call_6", { text: CLOSING_LINE });
      expect(said.content).toEqual([{ type: "text", text: SAID_RESULT }]);
      const other = await withCalls([]).execute("call_7", {
        text: "Running it against your agent now.",
      });
      expect(other.content).toEqual([{ type: "text", text: SAID_RESULT }]);
      // An empty line is still the empty pushback, never the rule.
      const empty = await withCalls([]).execute("call_8", { text: " " });
      expect(empty.content).toEqual([{ type: "text", text: EMPTY_SAY_PUSHBACK }]);
    });
  });

  describe("given the repeat rule", () => {
    const FRAMEWORK = "I found a LangGraph agent in app/graph.py.";
    const BLOCK = [
      FRAMEWORK,
      "I opened a pull request with the tracing change: https://example.test/acme/pull/8. You can merge it already.",
      "I left branch langy/llmops checked out: the agent you started runs on it.",
    ].join("\n");
    const said = (text: string, over: Partial<TurnCall> = {}): TurnCall => ({
      name: "say",
      input: { text },
      isError: false,
      output: SAID_RESULT,
      ...over,
    });
    const withCalls = (calls: TurnCall[]) =>
      registerSay((text) => closingLineRefusal({ text, calls }) ?? repeatedLineRefusal({ text, calls }));

    /** @scenario "A line already said in the turn is refused" */
    it("answers a line already said in the turn with the pushback, whitespace aside, and draws nothing", async () => {
      const tool = withCalls([said(BLOCK)]);
      await expect(tool.execute("call_9", { text: BLOCK })).rejects.toThrow(REPEATED_LINE_PUSHBACK);
      await expect(tool.execute("call_10", { text: `  ${BLOCK.replaceAll("\n", "\n\n")}\n` })).rejects.toThrow(
        REPEATED_LINE_PUSHBACK,
      );
      expect(REPEATED_LINE_PUSHBACK).toBe("Already said; do not repeat it. Go on with the step.");
    });

    /** @scenario "A line already said in the turn is refused" */
    it("says a different line, the same line in a later turn, and a line whose earlier say was refused", async () => {
      const other = await withCalls([said(BLOCK)]).execute("call_11", { text: "Running it against your agent now." });
      expect(other.content).toEqual([{ type: "text", text: SAID_RESULT }]);
      // One line of the block is not the block.
      const line = await withCalls([said(BLOCK)]).execute("call_12", { text: FRAMEWORK });
      expect(line.content).toEqual([{ type: "text", text: SAID_RESULT }]);
      // The turn's own calls are all that count: a new turn starts with none.
      const later = await withCalls([]).execute("call_13", { text: BLOCK });
      expect(later.content).toEqual([{ type: "text", text: SAID_RESULT }]);
      // A say the rules refused drew nothing, so the line was never said.
      const refused = said(CLOSING_LINE, { isError: true, output: CLOSING_LINE_PUSHBACK });
      const again = await withCalls([refused, completePath(0)]).execute("call_14", { text: CLOSING_LINE });
      expect(again.content).toEqual([{ type: "text", text: SAID_RESULT }]);
      expect(repeatedLineRefusal({ text: BLOCK, calls: [{ name: "todowrite", input: { text: BLOCK }, isError: false, output: "" }] })).toBeUndefined();
    });

    /** @scenario "A line already said in the turn is refused" */
    it("keeps the closing line rule ahead of it", async () => {
      await expect(withCalls([said(CLOSING_LINE)]).execute("call_15", { text: CLOSING_LINE })).rejects.toThrow(
        CLOSING_LINE_PUSHBACK,
      );
      await expect(
        withCalls([completePath(0), said(CLOSING_LINE)]).execute("call_16", { text: CLOSING_LINE }),
      ).rejects.toThrow(REPEATED_LINE_PUSHBACK);
    });
  });
});
