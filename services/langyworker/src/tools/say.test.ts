import { describe, expect, it } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  createSayExtension,
  EMPTY_SAY_PUSHBACK,
  renderSaid,
  SAID_RESULT,
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

function registerSay(): RegisteredTool {
  let registered: RegisteredTool | undefined;
  const pi = {
    registerTool: (tool: RegisteredTool) => {
      registered = tool;
    },
  };
  const extension = createSayExtension() as unknown as {
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
});
