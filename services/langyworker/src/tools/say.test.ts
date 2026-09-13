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

  describe("given the closing line rule of the guided path", () => {
    const completePath = (exitCode: number): TurnCall => ({
      name: "local_bash",
      input: { command: `${COMPLETE_PATH_COMMAND} llmops` },
      isError: false,
      output: `exit code: ${exitCode}\n\nstdout:\n`,
    });
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
});
