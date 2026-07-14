/**
 * @vitest-environment node
 *
 * Integration regression for the customer n8n failure:
 *
 *   HTTP 422: Unprocessable Entity ... {"code":422,"message":"Failed to parse
 *   request body","hint":"Bad control character in string literal in JSON ..."}
 *
 * Drives the real SerializedHttpAgentAdapter against a local server that
 * behaves like the n8n webhook did: it `JSON.parse`s the request body and
 * answers 422 with the same error shape when parsing fails. With a
 * conversation turn that contains a raw newline, quote and backslash, the body
 * the adapter sends must still be valid JSON.
 *
 * Covers the @integration scenario in
 * specs/scenarios/http-agent-body-template-json-safety.feature.
 */

import { createServer, type Server } from "node:http";
import { AgentRole, type AgentInput } from "@langwatch/scenario";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { HttpAgentData } from "../types";
import { SerializedHttpAgentAdapter } from "../serialized-adapters/http-agent.adapter";

// Use native fetch so localhost isn't blocked by SSRF protection. Vitest hoists
// vi.mock above the static import below, so the adapter still gets the mock.
vi.mock("~/utils/ssrfProtection", () => ({
  ssrfSafeFetch: async (url: string, init?: RequestInit) =>
    fetch(url, init),
}));

interface N8nLikeServer {
  url: string;
  lastParsedBody: () => unknown;
  close: () => Promise<void>;
}

/**
 * Mimics the n8n webhook: JSON-parses the body, replies 422 with n8n's exact
 * error envelope on failure, and echoes the parsed body on success.
 */
async function createN8nLikeServer(): Promise<N8nLikeServer> {
  let parsed: unknown;

  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString()));
    req.on("end", () => {
      try {
        parsed = JSON.parse(body);
      } catch {
        // Static hint mirroring n8n's envelope without echoing the parser
        // exception/stack into the response (CodeQL: stack-trace exposure).
        res.writeHead(422, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            code: 422,
            message: "Failed to parse request body",
            hint: "Bad control character in string literal in JSON",
          }),
        );
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "ok" } }],
        }),
      );
    });
  });

  const port: number = await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      typeof addr === "object" && addr
        ? resolve(addr.port)
        : reject(new Error("no address"));
    });
    server.on("error", reject);
  });

  return {
    url: `http://127.0.0.1:${port}`,
    lastParsedBody: () => parsed,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

describe("HTTP agent body JSON safety (n8n regression)", () => {
  let srv: N8nLikeServer;

  beforeAll(async () => {
    srv = await createN8nLikeServer();
  });

  afterAll(async () => {
    await srv.close();
  });

  function config(overrides?: Partial<HttpAgentData>): HttpAgentData {
    return {
      type: "http",
      agentId: "n8n-agent",
      url: srv.url,
      method: "POST",
      headers: [],
      outputPath: "$.choices[0].message.content",
      ...overrides,
    };
  }

  function input(content: string): AgentInput {
    return {
      threadId: "thread-1",
      messages: [{ role: "user", content }],
      newMessages: [{ role: "user", content }],
      requestedRole: AgentRole.AGENT,
      scenarioState: {} as AgentInput["scenarioState"],
      scenarioConfig: {} as AgentInput["scenarioConfig"],
    };
  }

  describe("given an n8n-style body template and an awkward conversation turn", () => {
    describe("when the adapter calls the webhook", () => {
      /** @scenario Adapter posts a parseable body to a real HTTP endpoint */
      it("sends a body the server can JSON-parse (no HTTP 422)", async () => {
        const adapter = new SerializedHttpAgentAdapter(
          config({
            bodyTemplate:
              '{"chatInput": "{{ input }}", "sessionId": "{{ threadId }}"}',
          }),
        );
        const awkward =
          'Please summarize:\n\n"Q3 results"\nwith a path C:\\reports\\q3';

        const result = await adapter.call(input(awkward));

        expect(result).toBe("ok");
        expect(srv.lastParsedBody()).toEqual({
          chatInput: awkward,
          sessionId: "thread-1",
        });
      });
    });
  });

  describe("given the default thread_id + messages template", () => {
    describe("when a turn contains newlines and quotes", () => {
      it("still posts a parseable body", async () => {
        const adapter = new SerializedHttpAgentAdapter(
          config({
            bodyTemplate:
              '{\n  "thread_id": "{{threadId}}",\n  "messages": {{messages}}\n}',
          }),
        );

        await adapter.call(input('line\nbreak and a "quote"'));

        expect(srv.lastParsedBody()).toEqual({
          thread_id: "thread-1",
          messages: [
            { role: "user", content: 'line\nbreak and a "quote"' },
          ],
        });
      });
    });
  });

  describe("given the bug were not fixed", () => {
    it("a raw-newline body would have produced the customer's 422", async () => {
      // Sanity-anchor: the un-escaped body the old code produced really is
      // rejected by the same server, proving the regression target is real.
      const brokenBody = '{"chatInput": "line one\nline two"}';
      const res = await fetch(srv.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: brokenBody,
      });

      expect(res.status).toBe(422);
      expect((await res.json()).message).toBe("Failed to parse request body");
    });
  });
});
