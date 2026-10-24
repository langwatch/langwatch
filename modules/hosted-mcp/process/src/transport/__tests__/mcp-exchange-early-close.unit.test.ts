import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";

import type { McpDoorReply } from "@langwatch/hosted-mcp-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it, vi } from "vitest";

import { answerMcpExchange } from "../mcp-endpoint.rest.ts";

function fakeExchange() {
  const request = new IncomingMessage(new Socket());
  request.method = "POST";
  request.url = "/mcp";
  const response = new ServerResponse(request);
  response.statusCode = 499;
  vi.spyOn(response, "writeHead").mockReturnValue(response);
  vi.spyOn(response, "end").mockReturnValue(response);
  return { request, response };
}

describe("the hosted MCP door", () => {
  describe("when the client leaves before the answer is decided", () => {
    /** @scenario A client that leaves before its answer is decided is still logged */
    it("writes the access log line once the answer resolves", async () => {
      const { request, response } = fakeExchange();
      const { logger, lines } = createTestLogger();
      let decide: (reply: McpDoorReply) => void = () => undefined;
      const reply = new Promise<McpDoorReply>((resolve) => {
        decide = resolve;
      });

      answerMcpExchange({
        endpoint: {
          answer: () => reply,
          answerFailure: () => ({ kind: "empty", status: 500, headers: {} }),
        },
        runner: { runAs: (_apiKey, work) => work() },
        request,
        response,
        accessLogger: logger,
      });
      response.emit("close");
      decide({
        answer: { kind: "empty", status: 204, headers: {} },
        accessLog: { method: "POST", path: "/mcp" },
        onClosed: () => undefined,
      });

      await vi.waitFor(() => {
        expect(lines.findLine("info", "MCP request")).toMatchObject({
          path: "/mcp",
          status: 499,
        });
      });
    });
  });
});
