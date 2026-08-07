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
 * criteria-graded run, so on such a model no run could reach a verdict.
 *
 * Reasoning is disabled by RETRY as the general mechanism: whether a model
 * accepts reasoning off is not knowable up front (Gemini 2.5 Pro answers
 * "Budget 0 is invalid. This model only works in thinking mode."), so the
 * request goes out untouched and is re-sent with reasoning off only when the
 * provider's rejection asks for exactly that — naming the parameter is not
 * enough, the remediation has to name the value. (`createJudgeModelFromParams`
 * additionally defaults reasoning off preemptively for the exact models
 * already observed to require it — #6620, covered by model.factory.unit.test.)
 *
 * Drives the real model built by `createModelFromParams` against a local server
 * standing in for the chat-completions endpoint. Only the network is local —
 * the provider, the request builder and the Vercel AI SDK call are the ones
 * production uses.
 *
 * Covers the @integration scenarios in
 * specs/scenarios/judge-transport-tool-reasoning.feature.
 */

import { createServer, type Server } from "node:http";
import { APICallError, generateText, tool } from "ai";
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

type EndpointRule =
  | "accept"
  | "reject-tools-without-reasoning-off"
  | "reject-reasoning-without-remedy"
  | "reject-unrelated";

interface StubEndpoint {
  url: string;
  bodies: () => Array<Record<string, unknown>>;
  close: () => Promise<void>;
}

const UNRELATED_REJECTION = {
  error: {
    type: "invalid_request_error",
    message: "Unsupported value for parameter 'temperature'.",
    param: "temperature",
  },
};

/**
 * A rejection carrying the same structured `param` as the one the retry answers,
 * but asking for nothing: the provider refused the reasoning setting without
 * saying what it would accept. Keying the retry on `param` alone would answer
 * this by re-sending the request with a value nobody requested.
 */
const UNSPECIFIC_REASONING_REJECTION = {
  error: {
    type: "invalid_request_error",
    message: "Unsupported value for parameter 'reasoning_effort'.",
    param: "reasoning_effort",
  },
};

/** The upstream 400 verbatim, including the structured `param` the retry keys on. */
function reasoningRejectionFor(model: unknown) {
  return {
    error: {
      type: "invalid_request_error",
      message: `Function tools with reasoning_effort are not supported for ${String(
        model,
      )} in /v1/chat/completions. To use function tools, use /v1/responses or set reasoning_effort to 'none'.`,
      param: "reasoning_effort",
    },
  };
}

function completionFor(body: Record<string, unknown>, carriesTools: boolean) {
  return {
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
  };
}

/** What the endpoint answers for one request under the given rule. */
function responseFor(
  rule: EndpointRule,
  body: Record<string, unknown>,
): { status: number; payload: unknown } {
  const carriesTools =
    Array.isArray(body.tools) && (body.tools as unknown[]).length > 0;

  if (rule === "reject-unrelated") {
    return { status: 400, payload: UNRELATED_REJECTION };
  }
  if (rule === "reject-reasoning-without-remedy") {
    return { status: 400, payload: UNSPECIFIC_REASONING_REJECTION };
  }
  if (
    rule === "reject-tools-without-reasoning-off" &&
    carriesTools &&
    body.reasoning_effort !== "none"
  ) {
    return { status: 400, payload: reasoningRejectionFor(body.model) };
  }
  return { status: 200, payload: completionFor(body, carriesTools) };
}

/**
 * Stands in for the chat-completions endpoint behind the gateway proxy.
 *
 * "reject-tools-without-reasoning-off" enforces the upstream rule.
 * "reject-reasoning-without-remedy" refuses the reasoning setting without
 * naming a value it would accept.
 * "reject-unrelated" answers a 400 that has nothing to do with reasoning.
 * "accept" takes anything and exists only to record the wire body.
 */
async function startEndpoint(
  rule: EndpointRule = "accept",
): Promise<StubEndpoint> {
  const bodies: Array<Record<string, unknown>> = [];

  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => (raw += chunk.toString()));
    req.on("end", () => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      bodies.push(body);
      const { status, payload } = responseFor(rule, body);
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    });
  });

  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const { port } = server.address() as { port: number };

  return {
    url: `http://127.0.0.1:${port}`,
    bodies: () => bodies,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * The structured shape of a surfaced provider rejection. Asserting on
 * `statusCode` + `error.param` (not the message prose) keeps the tests immune
 * to upstream rewording.
 */
async function surfacedRejection(
  request: Promise<unknown>,
): Promise<{ statusCode: number | undefined; param: unknown }> {
  const failure = await request.then(
    () => {
      throw new Error("expected the request to be rejected");
    },
    (error: unknown) => error,
  );
  if (!APICallError.isInstance(failure)) throw failure;
  const body = JSON.parse(failure.responseBody ?? "{}") as {
    error?: { param?: unknown };
  };
  return { statusCode: failure.statusCode, param: body.error?.param };
}

let endpoint: StubEndpoint | undefined;

afterEach(async () => {
  await endpoint?.close();
  endpoint = undefined;
});

describe("judge transport: function tools and reasoning effort", () => {
  describe("given an endpoint that rejects tools unless reasoning is off", () => {
    describe("when the request carries function tools", () => {
      /** @scenario "A refusal that names reasoning is answered by asking again without it" */
      it("retries with reasoning declared off and succeeds", async () => {
        endpoint = await startEndpoint("reject-tools-without-reasoning-off");
        const model = createModelFromParams({
          litellmParams: JUDGE_PARAMS,
          nlpServiceUrl: endpoint.url,
        });

        const result = await generateText({
          model,
          messages: [{ role: "user", content: "grade this" }],
          tools: { finishTest },
          toolChoice: "required",
        });

        const bodies = endpoint.bodies();
        expect(bodies).toHaveLength(2);
        expect(bodies[0]).not.toHaveProperty("reasoning_effort");
        expect(bodies[1]?.reasoning_effort).toBe("none");
        expect(result.toolCalls).toHaveLength(1);
      });
    });

    describe("when the judge grades a conversation against its criteria", () => {
      /** @scenario "A criteria-graded run reports the verdict its criteria produced" */
      it("reaches a verdict instead of an infrastructure error", async () => {
        endpoint = await startEndpoint("reject-tools-without-reasoning-off");
        const model = createModelFromParams({
          litellmParams: JUDGE_PARAMS,
          nlpServiceUrl: endpoint.url,
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
    });

    describe("when the caller already asked for a specific effort", () => {
      /** @scenario "A run that pins the judge's reasoning keeps it" */
      it("surfaces the rejection rather than rewriting the caller's intent", async () => {
        endpoint = await startEndpoint("reject-tools-without-reasoning-off");
        const model = createModelFromParams({
          litellmParams: JUDGE_PARAMS,
          nlpServiceUrl: endpoint.url,
        });

        const rejection = await surfacedRejection(
          generateText({
            model,
            messages: [{ role: "user", content: "grade this" }],
            tools: { finishTest },
            toolChoice: "required",
            providerOptions: {
              // Namespaced under `createOpenAICompatible`'s provider name,
              // which `createModelFromParams` derives from the model's prefix.
              // The camelCase spelling is the provider's first-class option; a
              // snake_case one is overwritten by it and never reaches the wire.
              openai: { reasoningEffort: "high" },
            },
          }),
        );
        expect(rejection).toEqual({
          statusCode: 400,
          param: "reasoning_effort",
        });

        const bodies = endpoint.bodies();
        expect(bodies).toHaveLength(1);
        expect(bodies[0]?.reasoning_effort).toBe("high");
      });
    });
  });

  describe("given an endpoint that accepts tool-carrying requests as they are", () => {
    describe("when the request carries function tools", () => {
      /** @scenario "A model that accepts the first attempt is never asked anything new" */
      it("sends exactly one request with no reasoning_effort", async () => {
        endpoint = await startEndpoint("accept");
        const model = createModelFromParams({
          litellmParams: JUDGE_PARAMS,
          nlpServiceUrl: endpoint.url,
        });

        await generateText({
          model,
          messages: [{ role: "user", content: "grade this" }],
          tools: { finishTest },
          toolChoice: "required",
        });

        const bodies = endpoint.bodies();
        expect(bodies).toHaveLength(1);
        expect(bodies[0]).not.toHaveProperty("reasoning_effort");
      });

      /**
       * The regression that forced the retry design: Gemini 2.5 Pro accepts
       * tool-carrying requests but rejects reasoning off ("Budget 0 is
       * invalid. This model only works in thinking mode."), so disabling
       * reasoning preemptively broke a judge that worked.
       */
      /** @scenario "A model whose reasoning cannot be disabled is never asked to disable it" */
      it("never asks a thinking-only model to disable reasoning", async () => {
        endpoint = await startEndpoint("accept");
        const model = createModelFromParams({
          litellmParams: {
            api_key: "test-key",
            model: "gemini/gemini-2.5-pro",
          },
          nlpServiceUrl: endpoint.url,
        });

        await generateText({
          model,
          messages: [{ role: "user", content: "grade this" }],
          tools: { finishTest },
          toolChoice: "required",
        });

        const bodies = endpoint.bodies();
        expect(bodies).toHaveLength(1);
        expect(bodies[0]).not.toHaveProperty("reasoning_effort");
      });
    });
  });

  describe("given an endpoint that refuses reasoning without naming a remedy", () => {
    describe("when the request carries function tools", () => {
      /** @scenario "A reasoning refusal that names no remedy is surfaced, not retried" */
      it("surfaces the rejection without guessing a value", async () => {
        endpoint = await startEndpoint("reject-reasoning-without-remedy");
        const model = createModelFromParams({
          litellmParams: JUDGE_PARAMS,
          nlpServiceUrl: endpoint.url,
        });

        const rejection = await surfacedRejection(
          generateText({
            model,
            messages: [{ role: "user", content: "grade this" }],
            tools: { finishTest },
            toolChoice: "required",
          }),
        );
        expect(rejection).toEqual({
          statusCode: 400,
          param: "reasoning_effort",
        });

        // The structured `param` matches the one the retry answers, so keying
        // on it alone would send a second request carrying a value the provider
        // never asked for.
        expect(endpoint.bodies()).toHaveLength(1);
      });
    });
  });

  describe("given an endpoint that rejects for an unrelated reason", () => {
    describe("when the request carries function tools", () => {
      /** @scenario "An unrelated rejection is surfaced, not retried" */
      it("surfaces the rejection without retrying", async () => {
        endpoint = await startEndpoint("reject-unrelated");
        const model = createModelFromParams({
          litellmParams: JUDGE_PARAMS,
          nlpServiceUrl: endpoint.url,
        });

        const rejection = await surfacedRejection(
          generateText({
            model,
            messages: [{ role: "user", content: "grade this" }],
            tools: { finishTest },
            toolChoice: "required",
          }),
        );
        expect(rejection).toEqual({ statusCode: 400, param: "temperature" });

        expect(endpoint.bodies()).toHaveLength(1);
      });
    });
  });
});
