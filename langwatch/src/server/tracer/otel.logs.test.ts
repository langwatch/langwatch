import type { IExportLogsServiceRequest } from "@opentelemetry/otlp-transformer";
import { assert, describe, expect, it } from "vitest";
import { z, type ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import type { DeepPartial } from "../../utils/types";
import { openTelemetryLogsRequestToTracesForCollection } from "./otel.logs";
import { spanSchema } from "./types.generated";

const springAICompleteChatRequest: DeepPartial<IExportLogsServiceRequest> = {
  resourceLogs: [
    {
      resource: {
        attributes: [
          {
            key: "service.name",
            value: {
              stringValue: "spring-ai-chat-service",
            },
          },
        ],
      },
      scopeLogs: [
        {
          scope: {
            name: "org.springframework.ai.chat.observation.ChatModelPromptContentObservationHandler",
          },
          logRecords: [
            {
              traceId: "755b1db22272958b92cb003f30058e74",
              spanId: "0dedf6826df097a9",
              timeUnixNano: "1748353030869334708",
              body: {
                stringValue: `Chat Model Prompt Content:
{"messages":[{"role":"user","content":"Hello, how are you?"}],"model":"gpt-4o-mini","temperature":0.7}`
              },
            },
          ],
        },
        {
          scope: {
            name: "org.springframework.ai.chat.observation.ChatModelCompletionObservationHandler",
          },
          logRecords: [
            {
              traceId: "755b1db22272958b92cb003f30058e74",
              spanId: "0dedf6826df097a9",
              timeUnixNano: "1748353033397302125",
              body: {
                stringValue: `Chat Model Completion:
{"choices":[{"message":{"role":"assistant","content":"Hello! I'm doing well, thank you for asking. How can I assist you today?"},"finish_reason":"stop"}],"model":"gpt-4o-mini-2024-07-18","usage":{"prompt_tokens":11,"completion_tokens":17,"total_tokens":28}}`
              },
            },
          ],
        },
      ],
    },
  ],
};

const springAIPromptOnlyRequest: DeepPartial<IExportLogsServiceRequest> = {
  resourceLogs: [
    {
      resource: {
        attributes: [
          {
            key: "service.name",
            value: {
              stringValue: "spring-ai-chat-service",
            },
          },
        ],
      },
      scopeLogs: [
        {
          scope: {
            name: "org.springframework.ai.chat.observation.ChatModelPromptContentObservationHandler",
          },
          logRecords: [
            {
              traceId: "755b1db22272958b92cb003f30058e74",
              spanId: "0dedf6826df097a9",
              timeUnixNano: "1748353030869334708",
              body: {
                stringValue: `Chat Model Prompt Content:
{"messages":[{"role":"system","content":"You are a helpful assistant."},{"role":"user","content":"What is the weather like?"}],"model":"gpt-3.5-turbo","temperature":0.5}`
              },
            },
          ],
        },
      ],
    },
  ],
};

const springAICompletionOnlyRequest: DeepPartial<IExportLogsServiceRequest> = {
  resourceLogs: [
    {
      resource: {
        attributes: [
          {
            key: "service.name",
            value: {
              stringValue: "spring-ai-chat-service",
            },
          },
        ],
      },
      scopeLogs: [
        {
          scope: {
            name: "org.springframework.ai.chat.observation.ChatModelCompletionObservationHandler",
          },
          logRecords: [
            {
              traceId: "abc123def456789012345678",
              spanId: "fedcba9876543210",
              timeUnixNano: "1748353033397302125",
              body: {
                stringValue: `Chat Model Completion:
{"choices":[{"message":{"role":"assistant","content":"I don't have access to real-time weather data. Please check a weather service for current conditions."},"finish_reason":"stop"}],"model":"gpt-3.5-turbo-2024-01-25","usage":{"prompt_tokens":25,"completion_tokens":23,"total_tokens":48}}`
              },
            },
          ],
        },
      ],
    },
  ],
};

const multipleSpansRequest: DeepPartial<IExportLogsServiceRequest> = {
  resourceLogs: [
    {
      resource: {
        attributes: [
          {
            key: "service.name",
            value: {
              stringValue: "spring-ai-multi-service",
            },
          },
        ],
      },
      scopeLogs: [
        {
          scope: {
            name: "org.springframework.ai.chat.observation.ChatModelPromptContentObservationHandler",
          },
          logRecords: [
            {
              traceId: "trace123456789abcdef",
              spanId: "span1111111111111111",
              timeUnixNano: "1748353030000000000",
              body: {
                stringValue: `Chat Model Prompt Content:
{"messages":[{"role":"user","content":"First question"}],"model":"gpt-4o-mini"}`
              },
            },
            {
              traceId: "trace123456789abcdef",
              spanId: "span2222222222222222",
              timeUnixNano: "1748353031000000000",
              body: {
                stringValue: `Chat Model Prompt Content:
{"messages":[{"role":"user","content":"Second question"}],"model":"gpt-4o-mini"}`
              },
            },
          ],
        },
        {
          scope: {
            name: "org.springframework.ai.chat.observation.ChatModelCompletionObservationHandler",
          },
          logRecords: [
            {
              traceId: "trace123456789abcdef",
              spanId: "span1111111111111111",
              timeUnixNano: "1748353032000000000",
              body: {
                stringValue: `Chat Model Completion:
{"choices":[{"message":{"role":"assistant","content":"First answer"},"finish_reason":"stop"}],"model":"gpt-4o-mini-2024-07-18"}`
              },
            },
            {
              traceId: "trace123456789abcdef",
              spanId: "span2222222222222222",
              timeUnixNano: "1748353033000000000",
              body: {
                stringValue: `Chat Model Completion:
{"choices":[{"message":{"role":"assistant","content":"Second answer"},"finish_reason":"stop"}],"model":"gpt-4o-mini-2024-07-18"}`
              },
            },
          ],
        },
      ],
    },
  ],
};

const unsupportedScopeRequest: DeepPartial<IExportLogsServiceRequest> = {
  resourceLogs: [
    {
      resource: {
        attributes: [
          {
            key: "service.name",
            value: {
              stringValue: "other-service",
            },
          },
        ],
      },
      scopeLogs: [
        {
          scope: {
            name: "some.other.scope.name",
          },
          logRecords: [
            {
              traceId: "755b1db22272958b92cb003f30058e74",
              spanId: "0dedf6826df097a9",
              timeUnixNano: "1748353030869334708",
              body: {
                stringValue: `Some Other Content:
{"data":"should be ignored"}`
              },
            },
          ],
        },
      ],
    },
  ],
};

const invalidJsonRequest: DeepPartial<IExportLogsServiceRequest> = {
  resourceLogs: [
    {
      resource: {
        attributes: [],
      },
      scopeLogs: [
        {
          scope: {
            name: "org.springframework.ai.chat.observation.ChatModelPromptContentObservationHandler",
          },
          logRecords: [
            {
              traceId: "755b1db22272958b92cb003f30058e74",
              spanId: "0dedf6826df097a9",
              timeUnixNano: "1748353030869334708",
              body: {
                stringValue: `Chat Model Prompt Content:
{invalid json content here}`
              },
            },
          ],
        },
      ],
    },
  ],
};

const emptyLogsRequest: DeepPartial<IExportLogsServiceRequest> = {
  resourceLogs: [],
};

describe("opentelemetry logs receiver", () => {
  it("receives a complete Spring AI chat interaction (prompt + completion)", async () => {
    const traces = openTelemetryLogsRequestToTracesForCollection(
      springAICompleteChatRequest
    );

    expect(traces).toHaveLength(1);

    const trace = traces[0];

    try {
      z.array(spanSchema).parse(trace!.spans);
    } catch (error) {
      const validationError = fromZodError(error as ZodError);
      console.log("trace", JSON.stringify(trace, undefined, 2));
      console.log("validationError", validationError);
      assert.fail(validationError.message);
    }

    expect(trace).toEqual({
      traceId: "755b1db22272958b92cb003f30058e74",
      spans: [
        {
          span_id: "0dedf6826df097a9",
          trace_id: "755b1db22272958b92cb003f30058e74",
          type: "llm",
          input: {
            type: "json",
            value: {
              messages: [{ role: "user", content: "Hello, how are you?" }],
              model: "gpt-4o-mini",
              temperature: 0.7,
            },
          },
          output: {
            type: "json",
            value: {
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: "Hello! I'm doing well, thank you for asking. How can I assist you today?",
                  },
                  finish_reason: "stop",
                },
              ],
              model: "gpt-4o-mini-2024-07-18",
              usage: {
                prompt_tokens: 11,
                completion_tokens: 17,
                total_tokens: 28,
              },
            },
          },
          timestamps: {
            ignore_timestamps_on_write: true,
            started_at: 1748353030869,
            finished_at: 0,
          },
        },
      ],
      evaluations: [],
      reservedTraceMetadata: {},
      customMetadata: {},
    });
  });

  it("receives a Spring AI prompt-only request", async () => {
    const traces = openTelemetryLogsRequestToTracesForCollection(
      springAIPromptOnlyRequest
    );

    expect(traces).toHaveLength(1);

    const trace = traces[0];

    try {
      z.array(spanSchema).parse(trace!.spans);
    } catch (error) {
      const validationError = fromZodError(error as ZodError);
      console.log("trace", JSON.stringify(trace, undefined, 2));
      console.log("validationError", validationError);
      assert.fail(validationError.message);
    }

    expect(trace).toEqual({
      traceId: "755b1db22272958b92cb003f30058e74",
      spans: [
        {
          span_id: "0dedf6826df097a9",
          trace_id: "755b1db22272958b92cb003f30058e74",
          type: "llm",
          input: {
            type: "json",
            value: {
              messages: [
                { role: "system", content: "You are a helpful assistant." },
                { role: "user", content: "What is the weather like?" },
              ],
              model: "gpt-3.5-turbo",
              temperature: 0.5,
            },
          },
          output: null,
          timestamps: {
            ignore_timestamps_on_write: true,
            started_at: 1748353030869,
            finished_at: 0,
          },
        },
      ],
      evaluations: [],
      reservedTraceMetadata: {},
      customMetadata: {},
    });
  });

  it("receives a Spring AI completion-only request", async () => {
    const traces = openTelemetryLogsRequestToTracesForCollection(
      springAICompletionOnlyRequest
    );

    expect(traces).toHaveLength(1);

    const trace = traces[0];

    try {
      z.array(spanSchema).parse(trace!.spans);
    } catch (error) {
      const validationError = fromZodError(error as ZodError);
      console.log("trace", JSON.stringify(trace, undefined, 2));
      console.log("validationError", validationError);
      assert.fail(validationError.message);
    }

    expect(trace).toEqual({
      traceId: "abc123def456789012345678",
      spans: [
        {
          span_id: "fedcba9876543210",
          trace_id: "abc123def456789012345678",
          type: "llm",
          input: null,
          output: {
            type: "json",
            value: {
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: "I don't have access to real-time weather data. Please check a weather service for current conditions.",
                  },
                  finish_reason: "stop",
                },
              ],
              model: "gpt-3.5-turbo-2024-01-25",
              usage: {
                prompt_tokens: 25,
                completion_tokens: 23,
                total_tokens: 48,
              },
            },
          },
          timestamps: {
            ignore_timestamps_on_write: true,
            started_at: 1748353033397,
            finished_at: 0,
          },
        },
      ],
      evaluations: [],
      reservedTraceMetadata: {},
      customMetadata: {},
    });
  });

  it("receives multiple spans in the same trace", async () => {
    const traces = openTelemetryLogsRequestToTracesForCollection(
      multipleSpansRequest
    );

    expect(traces).toHaveLength(1);

    const trace = traces[0];

    try {
      z.array(spanSchema).parse(trace!.spans);
    } catch (error) {
      const validationError = fromZodError(error as ZodError);
      console.log("trace", JSON.stringify(trace, undefined, 2));
      console.log("validationError", validationError);
      assert.fail(validationError.message);
    }

    expect(trace!.spans).toHaveLength(2);
    
    // Check first span
    const span1 = trace!.spans.find(s => s.span_id === "span1111111111111111");
    expect(span1).toBeDefined();
    expect(span1?.input?.value).toEqual({
      messages: [{ role: "user", content: "First question" }],
      model: "gpt-4o-mini",
    });
    expect(span1?.output?.value).toEqual({
      choices: [
        {
          message: { role: "assistant", content: "First answer" },
          finish_reason: "stop",
        },
      ],
      model: "gpt-4o-mini-2024-07-18",
    });

    // Check second span
    const span2 = trace!.spans.find(s => s.span_id === "span2222222222222222");
    expect(span2).toBeDefined();
    expect(span2?.input?.value).toEqual({
      messages: [{ role: "user", content: "Second question" }],
      model: "gpt-4o-mini",
    });
    expect(span2?.output?.value).toEqual({
      choices: [
        {
          message: { role: "assistant", content: "Second answer" },
          finish_reason: "stop",
        },
      ],
      model: "gpt-4o-mini-2024-07-18",
    });
  });

  it("ignores logs with unsupported scope names", async () => {
    const traces = openTelemetryLogsRequestToTracesForCollection(
      unsupportedScopeRequest
    );

    expect(traces).toHaveLength(0);
  });

  it("ignores logs with invalid JSON content", async () => {
    const traces = openTelemetryLogsRequestToTracesForCollection(
      invalidJsonRequest
    );

    expect(traces).toHaveLength(0);
  });

  it("handles empty logs request", async () => {
    const traces = openTelemetryLogsRequestToTracesForCollection(
      emptyLogsRequest
    );

    expect(traces).toHaveLength(0);
  });

  it("handles logs without trace or span IDs", async () => {
    const invalidIdsRequest: DeepPartial<IExportLogsServiceRequest> = {
      resourceLogs: [
        {
          resource: { attributes: [] },
          scopeLogs: [
            {
              scope: {
                name: "org.springframework.ai.chat.observation.ChatModelPromptContentObservationHandler",
              },
              logRecords: [
                {
                  // Missing traceId and spanId
                  timeUnixNano: "1748353030869334708",
                  body: {
                    stringValue: `Chat Model Prompt Content:
{"messages":[{"role":"user","content":"test"}]}`
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    const traces = openTelemetryLogsRequestToTracesForCollection(
      invalidIdsRequest
    );

    expect(traces).toHaveLength(0);
  });

  it("handles logs without body content", async () => {
    const noBodyRequest: DeepPartial<IExportLogsServiceRequest> = {
      resourceLogs: [
        {
          resource: { attributes: [] },
          scopeLogs: [
            {
              scope: {
                name: "org.springframework.ai.chat.observation.ChatModelPromptContentObservationHandler",
              },
              logRecords: [
                {
                  traceId: "755b1db22272958b92cb003f30058e74",
                  spanId: "0dedf6826df097a9",
                  timeUnixNano: "1748353030869334708",
                  // Missing body
                },
              ],
            },
          ],
        },
      ],
    };

    const traces = openTelemetryLogsRequestToTracesForCollection(
      noBodyRequest
    );

    expect(traces).toHaveLength(0);
  });

  it("handles malformed log content (missing identifier or content)", async () => {
    const malformedRequest: DeepPartial<IExportLogsServiceRequest> = {
      resourceLogs: [
        {
          resource: { attributes: [] },
          scopeLogs: [
            {
              scope: {
                name: "org.springframework.ai.chat.observation.ChatModelPromptContentObservationHandler",
              },
              logRecords: [
                {
                  traceId: "755b1db22272958b92cb003f30058e74",
                  spanId: "0dedf6826df097a9",
                  timeUnixNano: "1748353030869334708",
                  body: {
                    stringValue: "MalformedContent" // No newline separator
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    const traces = openTelemetryLogsRequestToTracesForCollection(
      malformedRequest
    );

    expect(traces).toHaveLength(0);
  });
}); 
