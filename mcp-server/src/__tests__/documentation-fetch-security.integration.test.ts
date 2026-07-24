import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { initConfig } from "../config.js";
import { fetchDocumentation, resolveDocumentationUrl } from "../documentation-fetch.js";

const MCP_HEADERS = {
  Accept: "application/json, text/event-stream",
  Authorization: "Bearer security-regression-test",
  "Content-Type": "application/json",
};

describe("MCP documentation fetch security", () => {
  describe("URL validation", () => {
    it.each([
      ["langwatch" as const, undefined, "https://langwatch.ai/docs/llms.txt"],
      ["scenario" as const, undefined, "https://langwatch.ai/scenario/llms.txt"],
      ["langwatch" as const, "observability/tracing", "https://langwatch.ai/docs/observability/tracing.md"],
      ["scenario" as const, "/scenario/guides/quickstart", "https://langwatch.ai/scenario/guides/quickstart.md"],
      [
        "langwatch" as const,
        "https://langwatch.ai/docs/llms.txt?format=raw",
        "https://langwatch.ai/docs/llms.txt?format=raw",
      ],
    ])("resolves trusted %s documentation URL %s", (kind, input, expected) => {
      expect(resolveDocumentationUrl(kind, input).toString()).toBe(expected);
    });

    it.each([
      ["langwatch" as const, "http://169.254.169.254/latest/meta-data/"],
      ["langwatch" as const, "https://langwatch.ai.attacker.example/docs/x"],
      ["langwatch" as const, "https://langwatch.ai@127.0.0.1/docs/x"],
      ["langwatch" as const, "https://langwatch.ai:444/docs/x"],
      ["langwatch" as const, "file:///etc/passwd"],
      ["langwatch" as const, "https://langwatch.ai/scenario/llms.txt"],
      ["langwatch" as const, "https://langwatch.ai/docs-evil/page.md"],
      ["scenario" as const, "https://langwatch.ai/docs/llms.txt"],
      ["scenario" as const, "https://langwatch.ai/scenario-evil/page.md"],
      ["langwatch" as const, "https://langwatch.ai/docs/../scenario/llms.txt"],
    ])("rejects untrusted %s documentation URL %s", (kind, input) => {
      expect(() => resolveDocumentationUrl(kind, input)).toThrow(/trusted LangWatch documentation URL/);
    });
  });

  it("disables redirects on trusted documentation fetches", async () => {
    let receivedRedirectMode: RequestRedirect | undefined;
    const fetchForTest: typeof fetch = async (_input, init) => {
      receivedRedirectMode = init?.redirect;
      return new Response("# documentation");
    };

    const text = await fetchDocumentation("langwatch", "https://langwatch.ai/docs/llms.txt", fetchForTest);

    expect(text).toBe("# documentation");
    expect(receivedRedirectMode).toBe("error");
  });

  it("rejects non-document responses from the trusted origin", async () => {
    const fetchForTest: typeof fetch = async () =>
      new Response("<html>unexpected</html>", {
        headers: { "Content-Type": "text/html" },
      });

    await expect(fetchDocumentation("langwatch", "https://langwatch.ai/docs/llms.txt", fetchForTest)).rejects.toThrow(
      /unexpected content type/
    );
  });

  describe("HTTP tool transport", () => {
    let mcpServer: Server;
    let targetServer: Server;
    let mcpPort: number;
    let targetPort: number;
    let sessionId: string;
    let targetHits = 0;
    let rpcId = 10;

    beforeAll(async () => {
      targetServer = createServer((_request, response) => {
        targetHits += 1;
        response.end("internal-only response");
      });
      await new Promise<void>((resolve) => {
        targetServer.listen(0, "127.0.0.1", resolve);
      });
      const targetAddress = targetServer.address();
      targetPort = typeof targetAddress === "object" && targetAddress ? targetAddress.port : 0;

      initConfig({ endpoint: "https://app.langwatch.ai" });
      const { startHttpServer } = await import("../http-server.js");
      const started = await startHttpServer({ port: 0 });
      mcpServer = started.server;
      mcpPort = started.port;

      const initializeResponse = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
        method: "POST",
        headers: MCP_HEADERS,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "security-test", version: "1.0.0" },
          },
        }),
      });
      sessionId = initializeResponse.headers.get("mcp-session-id") ?? "";
      expect(sessionId).not.toBe("");

      await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
        method: "POST",
        headers: { ...MCP_HEADERS, "mcp-session-id": sessionId },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }),
      });
    });

    afterAll(async () => {
      await Promise.all([
        new Promise<void>((resolve, reject) => {
          mcpServer.close((error) => (error ? reject(error) : resolve()));
        }),
        new Promise<void>((resolve, reject) => {
          targetServer.close((error) => (error ? reject(error) : resolve()));
        }),
      ]);
    });

    async function callDocumentationTool(
      name: "fetch_langwatch_docs" | "fetch_scenario_docs",
      url: string
    ): Promise<string> {
      const response = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
        method: "POST",
        headers: { ...MCP_HEADERS, "mcp-session-id": sessionId },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: rpcId++,
          method: "tools/call",
          params: { name, arguments: { url } },
        }),
      });

      expect(response.status).toBe(200);
      return response.text();
    }

    it.each(["fetch_langwatch_docs" as const, "fetch_scenario_docs" as const])(
      "blocks %s from reaching a loopback HTTP server",
      async (tool) => {
        const hitsBefore = targetHits;
        const body = await callDocumentationTool(tool, `http://127.0.0.1:${targetPort}/secrets`);

        expect(body).toContain("trusted LangWatch documentation URL");
        expect(targetHits).toBe(hitsBefore);
      }
    );

    it("blocks cross-namespace fetches through the real MCP handler", async () => {
      const body = await callDocumentationTool("fetch_langwatch_docs", "https://langwatch.ai/scenario/llms.txt");

      expect(body).toContain("trusted LangWatch documentation URL");
    });
  });
});
