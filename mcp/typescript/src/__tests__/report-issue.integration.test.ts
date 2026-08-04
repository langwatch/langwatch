import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { initConfig } from "../config.js";
import { createMcpServer } from "../create-mcp-server.js";
import { handleReportIssue } from "../tools/report-issue.js";

/**
 * Integration tests for the report_issue tool against a REAL local HTTP
 * server. Corresponds to specs/mcp-server/report-issue-tool.feature.
 */
describe("report_issue", () => {
  let server: Server;
  let endpoint: string;
  let received: { headers: Record<string, unknown>; body: any }[];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let data = "";
      req.on("data", (chunk: Buffer) => (data += chunk.toString()));
      req.on("end", () => {
        received.push({ headers: { ...req.headers }, body: JSON.parse(data) });
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "report-mcp-1" }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    received = [];
    initConfig({ endpoint, apiKey: undefined });
  });

  describe("given the registered tool set", () => {
    /** @scenario "The report tool is listed with an agent-facing description" */
    it("lists report_issue with the agent-facing consent description", () => {
      const server = createMcpServer();
      const tools = (
        server as unknown as {
          _registeredTools: Record<string, { description?: string }>;
        }
      )._registeredTools;
      expect(Object.keys(tools)).toContain("report_issue");
      const description = tools.report_issue?.description ?? "";
      expect(description).toMatch(/whenever you struggled/i);
      expect(description).toMatch(/ask the user for permission first/i);
    });
  });

  describe("given the user did not approve sending", () => {
    /** @scenario "Calls without user approval are rejected with instructions" */
    it("refuses with instructions to ask the user first", async () => {
      await expect(
        handleReportIssue({
          user_approved: false,
          title: "broken tool",
          summary: "search_traces 500s",
        }),
      ).rejects.toThrow(/ask the user/i);
      expect(received).toHaveLength(0);
    });
  });

  describe("given nothing to report", () => {
    it("asks for a summary or session content", async () => {
      await expect(
        handleReportIssue({ user_approved: true, title: "empty" }),
      ).rejects.toThrow(/Nothing to report/);
    });
  });

  describe("when the user approved a summary report", () => {
    /** @scenario "Reporting an issue through MCP reaches the LangWatch backend" */
    it("delivers it marked as coming from MCP and returns a thank-you", async () => {
      const text = await handleReportIssue({
        user_approved: true,
        title: "evaluator setup confusing",
        summary: "the evaluator wizard 404s on step 2",
        agent: "claude-code",
      });

      expect(received).toHaveLength(1);
      expect(received[0]?.body.source).toBe("mcp");
      expect(received[0]?.body.kind).toBe("summary");
      expect(received[0]?.body.title).toBe("evaluator setup confusing");
      expect(text).toContain("report-mcp-1");
      expect(text.toLowerCase()).toContain("thank you");
    });
  });

  describe("when the title itself includes a secret", () => {
    it("redacts it before sending", async () => {
      await handleReportIssue({
        user_approved: true,
        title: "X-Api-Key sk-proj-abcdefghijklmnopqrstuvwxyz123456 rejected",
        summary: "the key was rejected",
      });
      expect(received[0]?.body.title).toBe("X-Api-Key [SECRET] rejected");
    });
  });

  describe("when session content includes secrets", () => {
    /** @scenario "Session content passed through MCP is redacted before sending" */
    it("redacts them locally before sending", async () => {
      await handleReportIssue({
        user_approved: true,
        title: "agent stuck",
        session_content: JSON.stringify({
          role: "user",
          content: "my key sk-proj-abcdefghijklmnopqrstuvwxyz123456 failed",
        }),
      });

      const wire = JSON.stringify(received[0]?.body);
      expect(wire).not.toContain("sk-proj-abcdefghijklmnopqrstuvwxyz123456");
      expect(received[0]?.body.sessionData).toContain("[SECRET]");
      expect(received[0]?.body.kind).toBe("full_session");
    });
  });

  describe("when an API key is configured", () => {
    it("attaches it so the report links to the project", async () => {
      initConfig({ endpoint, apiKey: "sk-lw-mcp-key-abcdef1234567890" });
      await handleReportIssue({
        user_approved: true,
        title: "linked",
        summary: "linked report",
      });
      expect(received[0]?.headers.authorization).toBe(
        "Bearer sk-lw-mcp-key-abcdef1234567890",
      );
    });
  });
});
