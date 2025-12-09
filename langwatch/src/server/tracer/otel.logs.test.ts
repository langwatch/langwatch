import type { IExportLogsServiceRequest } from "@opentelemetry/otlp-transformer";
import { assert, describe, expect, it } from "vitest";
import { type ZodError, z } from "zod";
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
PROMPT_CONTENT`,
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
MODEL_COMPLETION_CONTENT`,
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
CHAT_MODEL_PROMPT_CONTENT`,
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
CHAT_MODEL_COMPLETION_CONTENT`,
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
MULTI_SPAN_CHAT_MODEL_PROMPT_CONTENT_1`,
              },
            },
            {
              traceId: "trace123456789abcdef",
              spanId: "span2222222222222222",
              timeUnixNano: "1748353031000000000",
              body: {
                stringValue: `Chat Model Prompt Content:
MULTI_SPAN_CHAT_MODEL_PROMPT_CONTENT_2`,
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
MULTI_SPAN_CHAT_MODEL_COMPLETION_1`,
              },
            },
            {
              traceId: "trace123456789abcdef",
              spanId: "span2222222222222222",
              timeUnixNano: "1748353033000000000",
              body: {
                stringValue: `Chat Model Completion:
MULTI_SPAN_CHAT_MODEL_COMPLETION_2`,
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
Some random content here`,
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

const claudeCodeLogsRequest: DeepPartial<IExportLogsServiceRequest> = {
  resourceLogs: [
    {
      resource: {
        attributes: [
          {
            key: "host.arch",
            value: {
              stringValue: "arm64",
            },
          },
          {
            key: "os.type",
            value: {
              stringValue: "darwin",
            },
          },
          {
            key: "os.version",
            value: {
              stringValue: "25.0.0",
            },
          },
          {
            key: "service.name",
            value: {
              stringValue: "claude-code",
            },
          },
          {
            key: "service.version",
            value: {
              stringValue: "1.0.123",
            },
          },
        ],
        droppedAttributesCount: 0,
      },
      scopeLogs: [
        {
          scope: {
            name: "com.anthropic.claude_code.events",
            version: "1.0.123",
          },
          logRecords: [
            {
              timeUnixNano: "1758733528124000000",
              observedTimeUnixNano: "1758733528124000000",
              body: {
                stringValue: "claude_code.user_prompt",
              },
              attributes: [
                {
                  key: "user.id",
                  value: {
                    stringValue:
                      "75104894e1c1be882bc30ece7070666d230f0ddb29725a612476947e4830c6b6",
                  },
                },
                {
                  key: "session.id",
                  value: {
                    stringValue: "fc91cef4-6d21-4829-adf5-9c1b955d06ff",
                  },
                },
                {
                  key: "organization.id",
                  value: {
                    stringValue: "6e82f9eb-36fc-4f74-a5ed-0a2e09f132ad",
                  },
                },
                {
                  key: "user.email",
                  value: {
                    stringValue: "rogerio@langwatch.ai",
                  },
                },
                {
                  key: "user.account_uuid",
                  value: {
                    stringValue: "c5742110-e420-4f5e-900a-9a11e0f738a1",
                  },
                },
                {
                  key: "terminal.type",
                  value: {
                    stringValue: "WarpTerminal",
                  },
                },
                {
                  key: "event.name",
                  value: {
                    stringValue: "user_prompt",
                  },
                },
                {
                  key: "event.timestamp",
                  value: {
                    stringValue: "2025-09-24T17:05:28.124Z",
                  },
                },
                {
                  key: "prompt_length",
                  value: {
                    stringValue: "4",
                  },
                },
                {
                  key: "prompt",
                  value: {
                    stringValue: "hiii",
                  },
                },
              ],
              droppedAttributesCount: 0,
            },
            {
              timeUnixNano: "1758733529180000000",
              observedTimeUnixNano: "1758733529180000000",
              body: {
                stringValue: "claude_code.api_request",
              },
              attributes: [
                {
                  key: "user.id",
                  value: {
                    stringValue:
                      "75104894e1c1be882bc30ece7070666d230f0ddb29725a612476947e4830c6b6",
                  },
                },
                {
                  key: "session.id",
                  value: {
                    stringValue: "fc91cef4-6d21-4829-adf5-9c1b955d06ff",
                  },
                },
                {
                  key: "organization.id",
                  value: {
                    stringValue: "6e82f9eb-36fc-4f74-a5ed-0a2e09f132ad",
                  },
                },
                {
                  key: "user.email",
                  value: {
                    stringValue: "rogerio@langwatch.ai",
                  },
                },
                {
                  key: "user.account_uuid",
                  value: {
                    stringValue: "c5742110-e420-4f5e-900a-9a11e0f738a1",
                  },
                },
                {
                  key: "terminal.type",
                  value: {
                    stringValue: "WarpTerminal",
                  },
                },
                {
                  key: "event.name",
                  value: {
                    stringValue: "api_request",
                  },
                },
                {
                  key: "event.timestamp",
                  value: {
                    stringValue: "2025-09-24T17:05:29.180Z",
                  },
                },
                {
                  key: "model",
                  value: {
                    stringValue: "claude-3-5-haiku-20241022",
                  },
                },
                {
                  key: "input_tokens",
                  value: {
                    stringValue: "87",
                  },
                },
                {
                  key: "output_tokens",
                  value: {
                    stringValue: "26",
                  },
                },
                {
                  key: "cache_read_tokens",
                  value: {
                    stringValue: "0",
                  },
                },
                {
                  key: "cache_creation_tokens",
                  value: {
                    stringValue: "0",
                  },
                },
                {
                  key: "cost_usd",
                  value: {
                    stringValue: "0.0001736",
                  },
                },
                {
                  key: "duration_ms",
                  value: {
                    stringValue: "1033",
                  },
                },
              ],
              droppedAttributesCount: 0,
            },
            {
              timeUnixNano: "1758733529251000000",
              observedTimeUnixNano: "1758733529251000000",
              body: {
                stringValue: "claude_code.api_request",
              },
              attributes: [
                {
                  key: "user.id",
                  value: {
                    stringValue:
                      "75104894e1c1be882bc30ece7070666d230f0ddb29725a612476947e4830c6b6",
                  },
                },
                {
                  key: "session.id",
                  value: {
                    stringValue: "fc91cef4-6d21-4829-adf5-9c1b955d06ff",
                  },
                },
                {
                  key: "organization.id",
                  value: {
                    stringValue: "6e82f9eb-36fc-4f74-a5ed-0a2e09f132ad",
                  },
                },
                {
                  key: "user.email",
                  value: {
                    stringValue: "rogerio@langwatch.ai",
                  },
                },
                {
                  key: "user.account_uuid",
                  value: {
                    stringValue: "c5742110-e420-4f5e-900a-9a11e0f738a1",
                  },
                },
                {
                  key: "terminal.type",
                  value: {
                    stringValue: "WarpTerminal",
                  },
                },
                {
                  key: "event.name",
                  value: {
                    stringValue: "api_request",
                  },
                },
                {
                  key: "event.timestamp",
                  value: {
                    stringValue: "2025-09-24T17:05:29.251Z",
                  },
                },
                {
                  key: "model",
                  value: {
                    stringValue: "claude-3-5-haiku-20241022",
                  },
                },
                {
                  key: "input_tokens",
                  value: {
                    stringValue: "109",
                  },
                },
                {
                  key: "output_tokens",
                  value: {
                    stringValue: "44",
                  },
                },
                {
                  key: "cache_read_tokens",
                  value: {
                    stringValue: "0",
                  },
                },
                {
                  key: "cache_creation_tokens",
                  value: {
                    stringValue: "0",
                  },
                },
                {
                  key: "cost_usd",
                  value: {
                    stringValue: "0.0002632",
                  },
                },
                {
                  key: "duration_ms",
                  value: {
                    stringValue: "1651",
                  },
                },
              ],
              droppedAttributesCount: 0,
            },
            {
              timeUnixNano: "1758733531844000000",
              observedTimeUnixNano: "1758733531844000000",
              body: {
                stringValue: "claude_code.api_request",
              },
              attributes: [
                {
                  key: "user.id",
                  value: {
                    stringValue:
                      "75104894e1c1be882bc30ece7070666d230f0ddb29725a612476947e4830c6b6",
                  },
                },
                {
                  key: "session.id",
                  value: {
                    stringValue: "fc91cef4-6d21-4829-adf5-9c1b955d06ff",
                  },
                },
                {
                  key: "organization.id",
                  value: {
                    stringValue: "6e82f9eb-36fc-4f74-a5ed-0a2e09f132ad",
                  },
                },
                {
                  key: "user.email",
                  value: {
                    stringValue: "rogerio@langwatch.ai",
                  },
                },
                {
                  key: "user.account_uuid",
                  value: {
                    stringValue: "c5742110-e420-4f5e-900a-9a11e0f738a1",
                  },
                },
                {
                  key: "terminal.type",
                  value: {
                    stringValue: "WarpTerminal",
                  },
                },
                {
                  key: "event.name",
                  value: {
                    stringValue: "api_request",
                  },
                },
                {
                  key: "event.timestamp",
                  value: {
                    stringValue: "2025-09-24T17:05:31.844Z",
                  },
                },
                {
                  key: "model",
                  value: {
                    stringValue: "claude-sonnet-4-20250514",
                  },
                },
                {
                  key: "input_tokens",
                  value: {
                    stringValue: "3",
                  },
                },
                {
                  key: "output_tokens",
                  value: {
                    stringValue: "15",
                  },
                },
                {
                  key: "cache_read_tokens",
                  value: {
                    stringValue: "4804",
                  },
                },
                {
                  key: "cache_creation_tokens",
                  value: {
                    stringValue: "10301",
                  },
                },
                {
                  key: "cost_usd",
                  value: {
                    stringValue: "0.04030395",
                  },
                },
                {
                  key: "duration_ms",
                  value: {
                    stringValue: "3547",
                  },
                },
              ],
              droppedAttributesCount: 0,
            },
          ],
        },
      ],
    },
  ],
};

describe("opentelemetry logs receiver", () => {
  it("receives a complete Spring AI chat interaction (prompt + completion)", async () => {
    const traces = await openTelemetryLogsRequestToTracesForCollection(
      springAICompleteChatRequest,
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
          name: "Chat Model Prompt Content",
          type: "llm",
          input: {
            type: "text",
            value: "PROMPT_CONTENT",
          },
          output: {
            type: "text",
            value: "MODEL_COMPLETION_CONTENT",
          },
          params: {},
          timestamps: {
            ignore_timestamps_on_write: true,
            started_at: 1748353030869,
            finished_at: 1748353030869,
          },
        },
      ],
      evaluations: [],
      reservedTraceMetadata: {},
      customMetadata: {},
    });
  });

  it("receives a Spring AI prompt-only request", async () => {
    const traces = await openTelemetryLogsRequestToTracesForCollection(
      springAIPromptOnlyRequest,
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
          name: "Chat Model Prompt Content",
          input: {
            type: "text",
            value: "CHAT_MODEL_PROMPT_CONTENT",
          },
          output: null,
          params: {},
          timestamps: {
            ignore_timestamps_on_write: true,
            started_at: 1748353030869,
            finished_at: 1748353030869,
          },
        },
      ],
      evaluations: [],
      reservedTraceMetadata: {},
      customMetadata: {},
    });
  });

  it("receives a Spring AI completion-only request", async () => {
    const traces = await openTelemetryLogsRequestToTracesForCollection(
      springAICompletionOnlyRequest,
    );

    expect(traces).toHaveLength(1);

    const trace = traces[0];

    if (!trace) {
      assert.fail("No trace found");
    }

    try {
      z.array(spanSchema).parse(trace.spans);
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
          name: "Chat Model Completion",
          input: null,
          output: {
            type: "text",
            value: "CHAT_MODEL_COMPLETION_CONTENT",
          },
          params: {},
          timestamps: {
            ignore_timestamps_on_write: true,
            started_at: 1748353033397,
            finished_at: 1748353033397,
          },
        },
      ],
      evaluations: [],
      reservedTraceMetadata: {},
      customMetadata: {},
    });
  });

  it("receives multiple spans in the same trace", async () => {
    const traces =
      await openTelemetryLogsRequestToTracesForCollection(multipleSpansRequest);

    expect(traces).toHaveLength(1);

    const trace = traces[0];
    if (!trace) {
      assert.fail("No trace found");
    }

    try {
      z.array(spanSchema).parse(trace.spans);
    } catch (error) {
      const validationError = fromZodError(error as ZodError);
      console.log("trace", JSON.stringify(trace, undefined, 2));
      console.log("validationError", validationError);
      assert.fail(validationError.message);
    }

    expect(trace.spans).toHaveLength(2);

    // Check first span
    const span1 = trace.spans.find((s) => s.span_id === "span1111111111111111");
    expect(span1).toBeDefined();
    expect(span1?.name).toEqual("Chat Model Prompt Content");
    expect(span1?.input?.value).toEqual(
      "MULTI_SPAN_CHAT_MODEL_PROMPT_CONTENT_1",
    );
    expect(span1?.output?.value).toEqual("MULTI_SPAN_CHAT_MODEL_COMPLETION_1");
    expect(span1?.name).toEqual("Chat Model Prompt Content");
    expect(span1?.input?.type).toEqual("text");
    expect(span1?.output?.type).toEqual("text");

    // Check second span
    const span2 = trace.spans.find((s) => s.span_id === "span2222222222222222");
    expect(span2).toBeDefined();
    expect(span2?.name).toEqual("Chat Model Prompt Content");
    expect(span2?.input?.value).toEqual(
      "MULTI_SPAN_CHAT_MODEL_PROMPT_CONTENT_2",
    );
    expect(span2?.output?.value).toEqual("MULTI_SPAN_CHAT_MODEL_COMPLETION_2");
    expect(span2?.input?.type).toEqual("text");
    expect(span2?.output?.type).toEqual("text");
  });

  it("includes logs with unsupported scope names", async () => {
    const traces = await openTelemetryLogsRequestToTracesForCollection(
      unsupportedScopeRequest,
    );

    expect(traces).toHaveLength(1);
  });

  it("handles empty logs request", async () => {
    const traces =
      await openTelemetryLogsRequestToTracesForCollection(emptyLogsRequest);

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
IGNORED_CONTENT`,
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    const traces =
      await openTelemetryLogsRequestToTracesForCollection(invalidIdsRequest);

    expect(traces).toHaveLength(1);
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

    const traces =
      await openTelemetryLogsRequestToTracesForCollection(noBodyRequest);

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
                    stringValue: "MalformedContent", // No newline separator
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    const traces =
      await openTelemetryLogsRequestToTracesForCollection(malformedRequest);

    expect(traces).toHaveLength(0);
  });

  it("handles claude code logs, getting the params", async () => {
    const traces = await openTelemetryLogsRequestToTracesForCollection(
      claudeCodeLogsRequest,
    );

    expect(traces).toHaveLength(1);
    expect(traces[0]?.spans).toHaveLength(4);
    expect(traces[0]?.spans[0]?.params).toEqual({
      event: {
        name: "user_prompt",
        timestamp: "2025-09-24T17:05:28.124Z",
      },
      organization: {
        id: "6e82f9eb-36fc-4f74-a5ed-0a2e09f132ad",
      },
      prompt: "hiii",
      prompt_length: "4",
      session: {
        id: "fc91cef4-6d21-4829-adf5-9c1b955d06ff",
      },
      terminal: {
        type: "WarpTerminal",
      },
      user: {
        account_uuid: "c5742110-e420-4f5e-900a-9a11e0f738a1",
        email: "rogerio@langwatch.ai",
        id: "75104894e1c1be882bc30ece7070666d230f0ddb29725a612476947e4830c6b6",
      },
    });
  });
});
