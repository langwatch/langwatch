/**
 * Stub harness for judge-transport integration tests: a local HTTP server
 * standing in for the chat-completions endpoint behind the gateway proxy,
 * plus the provider-rejection fixtures and the surfaced-error reader.
 *
 * Support module only — imported by
 * judge-transport-tool-reasoning.integration.test.ts.
 */

import { createServer, type Server } from "node:http";
import { APICallError } from "ai";

export type EndpointRule =
  | "accept"
  | "reject-tools-without-reasoning-off"
  | "reject-reasoning-always"
  | "reject-reasoning-without-remedy"
  | "reject-unrelated"
  | "reject-not-json";

export interface StubEndpoint {
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

function completionFor(body: Record<string, unknown>, hasTools: boolean) {
  return {
    id: "chatcmpl-stub",
    object: "chat.completion",
    created: 0,
    model: body.model,
    choices: [
      {
        index: 0,
        message: hasTools
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
        finish_reason: hasTools ? "tool_calls" : "stop",
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

/** What the endpoint answers for one request under the given rule. */
function responseFor(
  rule: EndpointRule,
  body: Record<string, unknown>,
): { status: number; payload: unknown; raw?: string } {
  const hasTools =
    Array.isArray(body.tools) && (body.tools as unknown[]).length > 0;

  if (rule === "reject-unrelated") {
    return { status: 400, payload: UNRELATED_REJECTION };
  }
  if (rule === "reject-reasoning-without-remedy") {
    return { status: 400, payload: UNSPECIFIC_REASONING_REJECTION };
  }
  if (rule === "reject-not-json") {
    return { status: 400, payload: undefined, raw: "Bad Request" };
  }
  if (rule === "reject-reasoning-always") {
    return { status: 400, payload: reasoningRejectionFor(body.model) };
  }
  if (
    rule === "reject-tools-without-reasoning-off" &&
    hasTools &&
    body.reasoning_effort !== "none"
  ) {
    return { status: 400, payload: reasoningRejectionFor(body.model) };
  }
  return { status: 200, payload: completionFor(body, hasTools) };
}

/**
 * Stands in for the chat-completions endpoint behind the gateway proxy.
 *
 * "reject-tools-without-reasoning-off" enforces the upstream rule.
 * "reject-reasoning-always" refuses reasoning even when it is off.
 * "reject-reasoning-without-remedy" refuses the reasoning setting without
 * naming a value it would accept.
 * "reject-unrelated" answers a 400 that has nothing to do with reasoning.
 * "reject-not-json" answers a 400 whose body is not JSON.
 * "accept" takes anything and exists only to record the wire body.
 */
export async function startEndpoint(
  rule: EndpointRule = "accept",
): Promise<StubEndpoint> {
  const bodies: Array<Record<string, unknown>> = [];

  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => (raw += chunk.toString()));
    req.on("end", () => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      bodies.push(body);
      const { status, payload, raw: rawResponse } = responseFor(rule, body);
      if (rawResponse !== undefined) {
        res.writeHead(status, { "Content-Type": "text/plain" });
        res.end(rawResponse);
        return;
      }
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
    close: () =>
      new Promise<void>((resolve) => {
        // close() alone only waits for existing connections to drain; drop
        // undici/AI SDK keep-alive sockets so afterEach never waits on them.
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/**
 * The structured shape of a surfaced provider rejection. Asserting on
 * `statusCode` + `error.param` (not the message prose) keeps the tests immune
 * to upstream rewording.
 */
export async function surfacedRejection(
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
