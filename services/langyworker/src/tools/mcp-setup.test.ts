import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { ENABLED_TOOLS } from "../session.js";
import {
  answerMcpSetup,
  createMcpSetupExtension,
  MCP_SETUP_SHOWN,
  MCP_SETUP_TOOL_DESCRIPTION,
  MCP_SETUP_TOOL_NAME,
  UNKNOWN_CLIENT_PUSHBACK,
  UNKNOWN_METHOD_PUSHBACK,
} from "./mcp-setup.js";

describe("answerMcpSetup", () => {
  describe("when Langy names no client", () => {
    /** @scenario "The worker tool puts up the card and tells the model not to repeat it" */
    it("shows the card and tells the model to leave the address and steps to it", () => {
      const answer = answerMcpSetup({});

      expect(answer).toEqual({ shown: true, text: MCP_SETUP_SHOWN });
      expect(answer.text).toContain("Do not repeat the address");
    });
  });

  describe("when Langy names a client and a method the card knows", () => {
    it("shows the card", () => {
      expect(answerMcpSetup({ client: "claude-code", method: "api-key" }).shown).toBe(true);
    });
  });

  describe("when Langy names a client the card has no steps for", () => {
    /** @scenario "An unknown client or method is refused with the options" */
    it("refuses and lists the clients it knows", () => {
      const answer = answerMcpSetup({ client: "emacs" });

      expect(answer).toEqual({ shown: false, text: UNKNOWN_CLIENT_PUSHBACK });
      expect(answer.text).toContain("claude-code");
    });
  });

  describe("when Langy names a method other than OAuth or an API key", () => {
    /** @scenario "An unknown client or method is refused with the options" */
    it("refuses and names the two methods", () => {
      const answer = answerMcpSetup({ method: "password" });

      expect(answer).toEqual({ shown: false, text: UNKNOWN_METHOD_PUSHBACK });
      expect(answer.text).toContain("oauth");
    });
  });
});

describe("the mcp_setup tool", () => {
  /** @scenario "The worker tool puts up the card and tells the model not to repeat it" */
  it("is on the session's allowlist and says when to use it", () => {
    expect(ENABLED_TOOLS).toContain(MCP_SETUP_TOOL_NAME);
    expect(MCP_SETUP_TOOL_DESCRIPTION).toMatch(/Claude.*Cursor.*ChatGPT/s);
  });
});

type RegisteredTool = {
  name: string;
  label: string;
  parameters: { properties: Record<string, unknown> };
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
  ) => Promise<{ content: { type: string; text: string }[] }>;
};

/** The tool as pi registers it, read through the same seam the say tool's test uses. */
function registerMcpSetup(): RegisteredTool {
  let registered: RegisteredTool | undefined;
  const pi = {
    registerTool: (tool: RegisteredTool) => {
      registered = tool;
    },
  };
  const extension = createMcpSetupExtension() as unknown as {
    factory: (pi: ExtensionAPI) => void;
  };
  extension.factory(pi as unknown as ExtensionAPI);
  if (!registered) throw new Error("mcp_setup did not register");
  return registered;
}

describe("the registered mcp_setup tool", () => {
  /** @scenario "The worker tool puts up the card and tells the model not to repeat it" */
  it("registers under its name and label with an optional client and method", async () => {
    const tool = registerMcpSetup();

    expect(tool.name).toBe(MCP_SETUP_TOOL_NAME);
    expect(tool.label).toBe("MCP setup");
    expect(Object.keys(tool.parameters.properties).toSorted()).toEqual(["client", "method"]);
    const result = await tool.execute("call_1", { client: "cursor" });
    expect(result.content).toEqual([{ type: "text", text: MCP_SETUP_SHOWN }]);
  });

  /** @scenario "An unknown client or method is refused with the options" */
  it("throws the pushback for a client the card does not know", async () => {
    const tool = registerMcpSetup();

    await expect(tool.execute("call_2", { client: "emacs" })).rejects.toThrow(
      UNKNOWN_CLIENT_PUSHBACK,
    );
  });
});
