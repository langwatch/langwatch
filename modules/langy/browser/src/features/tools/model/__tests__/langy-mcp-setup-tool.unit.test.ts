/**
 * The `mcp_setup` tool bridge (specs/langy/langy-mcp-setup.feature): which calls become cards,
 * and the steps the card shows for each client and sign-in method.
 */
import { describe, expect, it } from "vitest";

import {
  isMcpSetupToolPart,
  LANGWATCH_API_KEYS_PATH,
  MCP_SETUP_CLIENTS,
  mcpServerUrl,
  mcpSetupCalls,
  mcpSetupSteps,
} from "../langy-mcp-setup-tool.ts";

const BASE = "https://langwatch.acme.example";

function call(id: string, input: Record<string, unknown>, state = "output-available") {
  return { type: "tool-mcp_setup", state, toolCallId: id, input };
}

function stepsText(steps: ReturnType<typeof mcpSetupSteps>): string {
  return steps.map((step) => `${step.text}\n${step.code ?? ""}`).join("\n");
}

describe("mcpSetupCalls", () => {
  describe("given a message with an answered mcp_setup call", () => {
    it("yields one card with the client and OAuth preselected", () => {
      expect(
        mcpSetupCalls([{ type: "text", text: "Here is how." }, call("c1", { client: "cursor" })]),
      ).toEqual([{ callId: "c1", client: "cursor", method: "oauth" }]);
      expect(isMcpSetupToolPart(call("c1", {}))).toBe(true);
    });

    it("leaves the client open when Langy named none", () => {
      expect(mcpSetupCalls([call("c1", {})])).toEqual([
        { callId: "c1", client: null, method: "oauth" },
      ]);
    });
  });

  describe("given a call the worker refused or one still streaming", () => {
    it("draws no card", () => {
      expect(mcpSetupCalls([call("c1", { client: "emacs" }, "output-error")])).toEqual([]);
      expect(mcpSetupCalls([call("c2", {}, "input-streaming")])).toEqual([]);
    });
  });

  describe("given a client the card has no steps for", () => {
    it("draws no card", () => {
      expect(mcpSetupCalls([call("c1", { client: "emacs" })])).toEqual([]);
    });
  });
});

describe("mcpServerUrl", () => {
  it("is the deployment's base URL and /mcp, never /sse", () => {
    expect(mcpServerUrl(`${BASE}/`)).toBe(`${BASE}/mcp`);
    expect(mcpServerUrl(BASE)).not.toContain("/sse");
  });
});

describe("mcpSetupSteps", () => {
  describe("when the method is OAuth", () => {
    it("gives Claude Code the claude mcp add command with this deployment's URL", () => {
      const steps = mcpSetupSteps({ client: "claude-code", method: "oauth", appBaseUrl: BASE });

      expect(steps[0]?.code).toBe(`claude mcp add --transport http langwatch ${BASE}/mcp`);
      expect(stepsText(steps)).toContain("/mcp");
    });

    it("ends every client's steps with signing in and approving a project", () => {
      for (const client of MCP_SETUP_CLIENTS) {
        const steps = mcpSetupSteps({ client, method: "oauth", appBaseUrl: BASE });
        expect(steps.at(-1)?.text).toContain("approve the project");
      }
    });
  });

  describe("when the method is an API key", () => {
    it("links to the API keys page and sends the key as a Bearer header", () => {
      const steps = mcpSetupSteps({ client: "cursor", method: "api-key", appBaseUrl: BASE });

      expect(steps[0]?.link?.href).toBe(LANGWATCH_API_KEYS_PATH);
      expect(steps[0]?.text).toMatch(/choose Restricted/);
      expect(stepsText(steps)).toContain('"Authorization": "Bearer YOUR_API_KEY"');
    });

    it("has VS Code prompt for the key instead of writing it into the workspace file", () => {
      const steps = mcpSetupSteps({ client: "vscode", method: "api-key", appBaseUrl: BASE });

      expect(stepsText(steps)).toContain('"password": true');
      expect(stepsText(steps)).toContain('"Authorization": "Bearer ${input:langwatch-api-key}"');
      expect(stepsText(steps)).not.toContain("YOUR_API_KEY");
    });

    it("tells a ChatGPT user its connectors take OAuth only", () => {
      const steps = mcpSetupSteps({ client: "chatgpt", method: "api-key", appBaseUrl: BASE });

      expect(stepsText(steps)).toContain("Choose OAuth above");
    });

    it("never recommends the retired /sse address", () => {
      for (const client of MCP_SETUP_CLIENTS) {
        for (const method of ["oauth", "api-key"] as const) {
          expect(stepsText(mcpSetupSteps({ client, method, appBaseUrl: BASE }))).not.toContain(
            "/sse",
          );
        }
      }
    });
  });
});
