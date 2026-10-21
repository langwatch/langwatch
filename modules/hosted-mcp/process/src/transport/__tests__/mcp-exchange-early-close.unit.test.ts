import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";

import type { McpDoorReply } from "@langwatch/hosted-mcp-contract";
import { describe, expect, it, vi } from "vitest";

const { infoLines } = vi.hoisted(() => {
  const lines: { fields: Record<string, unknown>; message: string }[] = [];
  return { infoLines: lines };
});

vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const record = (fields: Record<string, unknown>, message: string) => {
    infoLines.push({ fields, message });
  };
  const stub: Record<string, unknown> = {
    info: record,
    debug: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  stub.child = () => stub;
  return { ...actual, createLogger: () => stub };
});

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
      });
      response.emit("close");
      decide({
        answer: { kind: "empty", status: 204, headers: {} },
        accessLog: { method: "POST", path: "/mcp" },
      });

      await vi.waitFor(() => {
        expect(infoLines.find((line) => line.message === "MCP request")?.fields).toMatchObject({
          path: "/mcp",
          status: 499,
        });
      });
    });
  });
});
