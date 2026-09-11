/**
 * What one observed Ollama exchange becomes.
 *
 * The bodies here are the shapes Ollama actually puts on the wire — a single
 * JSON answer, newline-delimited chunks, and the Server-Sent Events framing
 * of the OpenAI-compatible route — because the three framings are the only
 * reason this module is not a one-liner.
 */
import { describe, expect, it } from "vitest";

import {
  buildOllamaExportRequest,
  buildOllamaSpan,
  ollamaRouteFor,
  parseResponseRecords,
  type OllamaExchange,
  type SpanIdGenerator,
} from "../ollama-trace";

const ids: SpanIdGenerator = {
  traceId: () => "a".repeat(32),
  spanId: () => "b".repeat(16),
};

function attributes(span: NonNullable<ReturnType<typeof buildOllamaSpan>>) {
  const out: Record<string, unknown> = {};
  for (const attribute of span.attributes) {
    out[attribute.key] = Object.values(attribute.value)[0];
  }
  return out;
}

function exchange(overrides: Partial<OllamaExchange>): OllamaExchange {
  return {
    route: "chat",
    requestBody: "{}",
    responseBody: "",
    status: 200,
    startedAtMs: 1_000,
    endedAtMs: 2_000,
    ...overrides,
  };
}

describe("reading an ollama request path", () => {
  it("recognises the two native prompt routes and the OpenAI-compatible one", () => {
    expect(ollamaRouteFor("/api/chat")).toBe("chat");
    expect(ollamaRouteFor("/api/generate")).toBe("generate");
    expect(ollamaRouteFor("/v1/chat/completions")).toBe("openai-chat");
  });

  it("ignores a query string and a trailing slash", () => {
    expect(ollamaRouteFor("/api/chat/")).toBe("chat");
    expect(ollamaRouteFor("/api/chat?stream=true")).toBe("chat");
  });

  it("leaves every other route unread", () => {
    expect(ollamaRouteFor("/api/tags")).toBeNull();
    expect(ollamaRouteFor("/api/pull")).toBeNull();
    expect(ollamaRouteFor("/")).toBeNull();
  });
});

describe("reading a response body", () => {
  it("reads one JSON object", () => {
    expect(parseResponseRecords('{"done":true}')).toEqual([{ done: true }]);
  });

  it("reads newline-delimited chunks", () => {
    expect(parseResponseRecords('{"a":1}\n{"a":2}\n')).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("reads Server-Sent Events and drops the terminator", () => {
    expect(parseResponseRecords('data: {"a":1}\n\ndata: [DONE]\n\n')).toEqual([{ a: 1 }]);
  });

  it("keeps the complete chunks of a stream that was cut off", () => {
    expect(parseResponseRecords('{"a":1}\n{"a":2}\n{"a":')).toEqual([{ a: 1 }, { a: 2 }]);
  });
});

describe("building the span for a chat call", () => {
  describe("when the answer arrived in one piece", () => {
    /** @scenario "A chat call is reported as one LangWatch call" */
    it("carries the conversation, the reply, the model and the token counts", () => {
      const span = buildOllamaSpan(
        exchange({
          requestBody: JSON.stringify({
            model: "llama3",
            stream: false,
            messages: [{ role: "user", content: "why is the sky blue?" }],
            options: { temperature: 0.2 },
          }),
          responseBody: JSON.stringify({
            model: "llama3",
            message: { role: "assistant", content: "Rayleigh scattering." },
            done: true,
            done_reason: "stop",
            prompt_eval_count: 12,
            eval_count: 5,
          }),
        }),
        ids,
      );

      expect(span).not.toBeNull();
      const read = attributes(span!);
      expect(read["langwatch.span.type"]).toBe("llm");
      expect(read["gen_ai.provider.name"]).toBe("ollama");
      expect(read["gen_ai.operation.name"]).toBe("chat");
      expect(JSON.parse(String(read["langwatch.input"]))).toEqual({
        type: "chat_messages",
        value: [{ role: "user", content: "why is the sky blue?" }],
      });
      expect(read["langwatch.output"]).toBe("Rayleigh scattering.");
      expect(read["gen_ai.request.model"]).toBe("llama3");
      expect(read["gen_ai.response.model"]).toBe("llama3");
      expect(read["gen_ai.usage.input_tokens"]).toBe("12");
      expect(read["gen_ai.usage.output_tokens"]).toBe("5");
      expect(read["gen_ai.request.stream"]).toBe(false);
      expect(read["gen_ai.request.temperature"]).toBe(0.2);
      expect(read["gen_ai.response.finish_reasons"]).toBe("stop");
      expect(span!.status).toEqual({});
    });

    it("spans the time the call took", () => {
      const span = buildOllamaSpan(
        exchange({
          requestBody: JSON.stringify({ model: "llama3", messages: [] }),
          startedAtMs: 1_700_000_000_000,
          endedAtMs: 1_700_000_002_500,
        }),
        ids,
      );

      expect(span!.startTimeUnixNano).toBe("1700000000000000000");
      expect(span!.endTimeUnixNano).toBe("1700000002500000000");
    });
  });

  describe("when the answer arrived one chunk at a time", () => {
    /** @scenario "A streamed reply reaches the caller as it arrives" */
    it("reports the whole assembled answer", () => {
      const span = buildOllamaSpan(
        exchange({
          requestBody: JSON.stringify({
            model: "llama3",
            messages: [{ role: "user", content: "count" }],
          }),
          responseBody: [
            '{"model":"llama3","message":{"role":"assistant","content":"one "},"done":false}',
            '{"model":"llama3","message":{"role":"assistant","content":"two"},"done":false}',
            '{"model":"llama3","message":{"role":"assistant","content":""},"done":true,"prompt_eval_count":3,"eval_count":2}',
          ].join("\n"),
        }),
        ids,
      );

      const read = attributes(span!);
      expect(read["langwatch.output"]).toBe("one two");
      expect(read["gen_ai.usage.output_tokens"]).toBe("2");
      // Native Ollama streams unless told not to, so an absent `stream` is
      // a streamed call, not a non-streamed one.
      expect(read["gen_ai.request.stream"]).toBe(true);
    });
  });

  describe("when the conversation carried an image", () => {
    it("records that an image was sent without carrying the image", () => {
      const span = buildOllamaSpan(
        exchange({
          requestBody: JSON.stringify({
            model: "llava",
            messages: [{ role: "user", content: "what is this?", images: ["QUJD".repeat(400)] }],
          }),
        }),
        ids,
      );

      const input = String(attributes(span!)["langwatch.input"]);
      expect(input).not.toContain("QUJDQUJD");
      expect(input).toContain("<image omitted, 1600 characters>");
    });
  });
});

describe("building the span for a completion call", () => {
  /** @scenario "A completion call is reported with its prompt and its answer" */
  it("carries the prompt as text and the assembled answer", () => {
    const span = buildOllamaSpan(
      exchange({
        route: "generate",
        requestBody: JSON.stringify({ model: "llama3", prompt: "haiku about ports" }),
        responseBody: ['{"response":"small "}', '{"response":"ships","done":true}'].join("\n"),
      }),
      ids,
    );

    const read = attributes(span!);
    expect(JSON.parse(String(read["langwatch.input"]))).toEqual({
      type: "text",
      value: "haiku about ports",
    });
    expect(read["langwatch.output"]).toBe("small ships");
    expect(read["gen_ai.operation.name"]).toBe("text_completion");
  });
});

describe("building the span for an OpenAI-compatible call", () => {
  /** @scenario "A call made through the OpenAI-compatible endpoint is reported the same way" */
  it("reads the streamed deltas and the usage block", () => {
    const span = buildOllamaSpan(
      exchange({
        route: "openai-chat",
        requestBody: JSON.stringify({
          model: "llama3",
          stream: true,
          temperature: 0.7,
          messages: [{ role: "user", content: "hello" }],
        }),
        responseBody: [
          'data: {"model":"llama3","choices":[{"delta":{"content":"hi"}}]}',
          'data: {"model":"llama3","choices":[{"delta":{"content":" there"},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":2}}',
          "data: [DONE]",
        ].join("\n\n"),
      }),
      ids,
    );

    const read = attributes(span!);
    expect(read["langwatch.output"]).toBe("hi there");
    expect(read["gen_ai.usage.input_tokens"]).toBe("4");
    expect(read["gen_ai.usage.output_tokens"]).toBe("2");
    expect(read["gen_ai.response.finish_reasons"]).toBe("stop");
    expect(read["gen_ai.request.temperature"]).toBe(0.7);
  });

  it("reads a non-streamed answer from the message body", () => {
    const span = buildOllamaSpan(
      exchange({
        route: "openai-chat",
        requestBody: JSON.stringify({
          model: "llama3",
          messages: [{ role: "user", content: "x" }],
        }),
        responseBody: JSON.stringify({
          model: "llama3",
          choices: [{ message: { role: "assistant", content: "y" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      }),
      ids,
    );

    expect(attributes(span!)["langwatch.output"]).toBe("y");
    // The OpenAI-compatible route does not stream unless asked.
    expect(attributes(span!)["gen_ai.request.stream"]).toBe(false);
  });
});

describe("when the server refused the call", () => {
  /** @scenario "A server error is returned to the caller and reported as a failed call" */
  it("marks the span failed and keeps the reason", () => {
    const span = buildOllamaSpan(
      exchange({
        requestBody: JSON.stringify({ model: "missing", messages: [] }),
        responseBody: '{"error":"model \'missing\' not found"}',
        status: 404,
      }),
      ids,
    );

    expect(span!.status.code).toBe(2);
    expect(span!.status.message).toContain("not found");
    expect(attributes(span!)["http.response.status_code"]).toBe("404");
  });
});

describe("when the request said nothing a span could carry", () => {
  it("produces no span for a body that is not JSON", () => {
    expect(buildOllamaSpan(exchange({ requestBody: "not json at all" }), ids)).toBeNull();
  });

  it("produces no span for JSON with neither a model nor a prompt", () => {
    expect(buildOllamaSpan(exchange({ requestBody: '{"keep_alive":0}' }), ids)).toBeNull();
  });
});

describe("the export envelope", () => {
  it("names the ollama service under a langwatch scope", () => {
    const request = buildOllamaExportRequest([]) as {
      resourceSpans: {
        resource: { attributes: { key: string; value: { stringValue: string } }[] };
        scopeSpans: { scope: { name: string }; spans: unknown[] }[];
      }[];
    };

    expect(request.resourceSpans[0]!.resource.attributes[0]).toEqual({
      key: "service.name",
      value: { stringValue: "ollama" },
    });
    // A langwatch.* scope keeps these content spans clear of the ingestion
    // side's infrastructure-span filter, the same way the codex harvest does.
    expect(request.resourceSpans[0]!.scopeSpans[0]!.scope.name).toBe("langwatch.ollama");
  });
});
