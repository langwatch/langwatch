import { describe, expect, it } from "vitest";

import { ENABLED_TOOLS } from "../session.js";
import {
  answerMcpSetup,
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
