/**
 * @vitest-environment node
 *
 * Integration regression for #6369 (and its Python sibling,
 * langwatch/scenario#864):
 *
 *   AI_APICallError: Function tools with reasoning_effort are not supported for
 *   gpt-5.6-sol in /v1/chat/completions. To use function tools, use
 *   /v1/responses or set reasoning_effort to 'none'.
 *
 * The judge forces a finish_test / continue_test function-tool call on every
 * criteria-graded run, so on a reasoning model no run could reach a verdict.
 *
 * Drives the real model built by `createModelFromParams` against a local server
 * that enforces the endpoint's rule: a request carrying function tools is
 * rejected with that exact error unless it declares `reasoning_effort: "none"`.
 * Only the network is local — the provider, the request builder and the Vercel
 * AI SDK call are the ones production uses.
 *
 * Covers the @integration scenarios in
 * specs/scenarios/judge-transport-tool-reasoning.feature.
 */

import { createServer, type Server } from "node:http";
import { generateText, tool } from "ai";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createModelFromParams } from "../model.factory";
import type { LiteLLMParams } from "../types";

const JUDGE_PARAMS: LiteLLMParams = {
  api_key: "test-key",
  model: "openai/gpt-5.6-sol",
};

/** The finish_test tool the judge forces — shape mirrors the SDK's. */
const finishTest = tool({
  description: "Complete the test with a verdict",
  inputSchema: z.object({
    verdict: z.enum(["success", "failure"]),
    reasoning: z.string(),
  }),
});

interface StubEndpoint {
  url: string;
  bodies: () => Array<Record<string, unknown>>;
  close: () => Promise<void>;
}

/**
 * Stands in for the chat-completions endpoint behind the gateway proxy.
 *
 * `enforceReasoningRule` reproduces the upstream 400 verbatim: function tools
 * are refused unless the caller explicitly declared reasoning off. With it off,
 * the server accepts anything and exists only to record the wire body.
 */
async function startEndpoint({
  enforceReasoningRule = false,
}: { enforceReasoningRule?: boolean } = {}): Promise<StubEndpoint> {
  const bodies: Array<Record<string, unknown>> = [];

  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => (raw += chunk.toString()));
    req.on("end", () => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      bodies.push(body);

      const carriesTools =
        Array.isArray(body.tools) && (body.tools as unknown[]).length > 0;
      if (
        enforceReasoningRule &&
        carriesTools &&
        body.reasoning_effort !== "none"
      ) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              type: "invalid_request_error",
              message: `Function tools with reasoning_effort are not supported for ${String(
                body.model,
              )} in /v1/chat/completions. To use function tools, use /v1/responses or set reasoning_effort to 'none'.`,
            },
          }),
        );
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-stub",
          object: "chat.completion",
          created: 0,
          model: body.model,
          choices: [
            {
              index: 0,
              message: carriesTools
                ? {
                    role: "assistant",
                    content: null,
                    tool_calls: [
                      {
                        id: "call_1",
                        type: "function",
                        function: {
                          name: "finishTest",
                          arguments: JSON.stringify({
                            verdict: "success",
                            reasoning: "criteria met",
                          }),
                        },
                      },
                    ],
                  }
                : { role: "assistant", content: "plain answer" },
              finish_reason: carriesTools ? "tool_calls" : "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    });
  });

  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const { port } = server.address() as { port: number };

  return {
    url: `http://127.0.0.1:${port}`,
    bodies: () => bodies,
    close: () =>
      new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

let endpoint: StubEndpoint | undefined;

afterEach(async () => {
  await endpoint?.close();
  endpoint = undefined;
});

describe("judge transport: function tools and reasoning effort", () => {
  describe("given a model whose target accepts reasoning_effort", () => {
    describe("when the request carries function tools", () => {
      /** @scenario "A tool-carrying request to a reasoning model declares reasoning off" */
      it("declares reasoning off on the wire", async () => {
        endpoint = await startEndpoint();
        const model = createModelFromParams(JUDGE_PARAMS, endpoint.url, {
          modelSupportsReasoningEffort: true,
        });

        await generateText({
          model,
          messages: [{ role: "user", content: "grade this" }],
          tools: { finishTest },
          toolChoice: "required",
        });

        expect(endpoint.bodies()[0]?.reasoning_effort).toBe("none");
      });
    });

    describe("when the request carries no tools", () => {
      /** @scenario "A request without tools is left alone" */
      it("sends no reasoning_effort", async () => {
        endpoint = await startEndpoint();
        const model = createModelFromParams(JUDGE_PARAMS, endpoint.url, {
          modelSupportsReasoningEffort: true,
        });

        await generateText({
          model,
          messages: [{ role: "user", content: "just answer" }],
        });

        expect(endpoint.bodies()[0]).not.toHaveProperty("reasoning_effort");
      });
    });

    describe("when the caller already asked for a specific effort", () => {
      /** @scenario "An explicitly requested reasoning effort is preserved" */
      it("preserves the caller's value rather than rewriting it", async () => {
        endpoint = await startEndpoint();
        const model = createModelFromParams(JUDGE_PARAMS, endpoint.url, {
          modelSupportsReasoningEffort: true,
        });

        await generateText({
          model,
          messages: [{ role: "user", content: "grade this" }],
          tools: { finishTest },
          toolChoice: "required",
          providerOptions: {
            // Namespaced under `createOpenAICompatible`'s provider name, which
            // `createModelFromParams` derives from the model's prefix. The
            // camelCase spelling is the provider's first-class option; a
            // snake_case one is overwritten by it and never reaches the wire.
            openai: { reasoningEffort: "high" },
          },
        });

        expect(endpoint.bodies()[0]?.reasoning_effort).toBe("high");
      });
    });
  });

  describe("given a model whose target does not accept reasoning_effort", () => {
    describe("when the request carries function tools", () => {
      /** @scenario "A model that does not accept reasoning_effort is left alone" */
      it("sends no reasoning_effort", async () => {
        endpoint = await startEndpoint();
        const model = createModelFromParams(
          { api_key: "test-key", model: "openai/gpt-4o" },
          endpoint.url,
          { modelSupportsReasoningEffort: false },
        );

        await generateText({
          model,
          messages: [{ role: "user", content: "grade this" }],
          tools: { finishTest },
          toolChoice: "required",
        });

        expect(endpoint.bodies()[0]).not.toHaveProperty("reasoning_effort");
      });
    });
  });

  describe("given an endpoint that enforces the tools/reasoning rule", () => {
    describe("when the judge grades a conversation against its criteria", () => {
      /** @scenario "The judge reaches a verdict against an endpoint that enforces the rule" */
      it("reaches a verdict instead of an infrastructure error", async () => {
        endpoint = await startEndpoint({ enforceReasoningRule: true });
        const model = createModelFromParams(JUDGE_PARAMS, endpoint.url, {
          modelSupportsReasoningEffort: true,
        });

        const result = await generateText({
          model,
          messages: [{ role: "user", content: "grade this" }],
          tools: { finishTest },
          toolChoice: "required",
        });

        expect(result.toolCalls[0]?.input).toEqual({
          verdict: "success",
          reasoning: "criteria met",
        });
      });

      /**
       * Falsifiability: without the fix the same endpoint answers 400 with the
       * upstream message. Pinning it here means a regression that reverts the
       * transport rule cannot pass this file by loosening one assertion.
       */
      /** @scenario "The judge reaches a verdict against an endpoint that enforces the rule" */
      it("fails the way #6369 reported when reasoning is not declared off", async () => {
        endpoint = await startEndpoint({ enforceReasoningRule: true });
        const unfixed = createModelFromParams(JUDGE_PARAMS, endpoint.url, {
          modelSupportsReasoningEffort: false,
        });

        await expect(
          generateText({
            model: unfixed,
            messages: [{ role: "user", content: "grade this" }],
            tools: { finishTest },
            toolChoice: "required",
          }),
        ).rejects.toThrow(/Function tools with reasoning_effort are not supported/);
      });
    });
  });
});
