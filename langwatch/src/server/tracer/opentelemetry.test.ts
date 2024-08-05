// @ts-ignore
import { type IExportTraceServiceRequest } from "@opentelemetry/otlp-transformer";
import { assert, describe, expect, it } from "vitest";
import { z, type ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import { openTelemetryTraceRequestToTracesForCollection } from "./opentelemetry";
import { spanSchema } from "./types.generated";

const openInferenceOpenAIRequest: IExportTraceServiceRequest = {
  resourceSpans: [
    {
      resource: {
        attributes: [
          {
            key: "telemetry.sdk.language",
            value: {
              stringValue: "python",
            },
          },
          {
            key: "telemetry.sdk.name",
            value: {
              stringValue: "opentelemetry",
            },
          },
          {
            key: "telemetry.sdk.version",
            value: {
              stringValue: "1.25.0",
            },
          },
          {
            key: "service.name",
            value: {
              stringValue: "unknown_service",
            },
          },
        ],
      },
      scopeSpans: [
        {
          scope: {
            name: "openinference.instrumentation.openai",
            version: "0.1.12",
          },
          spans: [
            {
              traceId: "A8suuE3VKsm8FJapnHM4gA==",
              spanId: "m6IZGoTJqJE=",
              name: "ChatCompletion",
              kind: "SPAN_KIND_INTERNAL",
              startTimeUnixNano: "1722809513563529000",
              endTimeUnixNano: "1722809514125001000",
              attributes: [
                {
                  key: "openinference.span.kind",
                  value: {
                    stringValue: "LLM",
                  },
                },
                {
                  key: "input.value",
                  value: {
                    stringValue:
                      '{"messages": [{"role": "system", "content": "You are a helpful assistant that only reply in short tweet-like responses, using lots of emojis."}, {"role": "user", "content": "hi"}], "model": "gpt-4o-mini", "stream": true}',
                  },
                },
                {
                  key: "input.mime_type",
                  value: {
                    stringValue: "application/json",
                  },
                },
                {
                  key: "output.value",
                  value: {
                    stringValue:
                      '{"choices": [{"message": {"content": "Hey there! 😊👋 What’s up? 🌟", "role": "assistant"}, "index": 0, "finish_reason": "stop"}], "id": "chatcmpl-9sdk9jAOO21SHl5mgTZSXVdCVJhDq", "created": 1722809513, "model": "gpt-4o-mini-2024-07-18", "object": "chat.completion.chunk", "system_fingerprint": "fp_611b667b19"}',
                  },
                },
                {
                  key: "output.mime_type",
                  value: {
                    stringValue: "application/json",
                  },
                },
                {
                  key: "llm.invocation_parameters",
                  value: {
                    stringValue: '{"model": "gpt-4o-mini", "stream": true}',
                  },
                },
                {
                  key: "session.id",
                  value: {
                    stringValue: "my-test-session",
                  },
                },
                {
                  key: "user.id",
                  value: {
                    stringValue: "my-test-user",
                  },
                },
                {
                  key: "metadata",
                  value: {
                    stringValue: '{"foo": "bar"}',
                  },
                },
                {
                  key: "tag.tags",
                  value: {
                    arrayValue: {
                      values: [
                        {
                          stringValue: "tag-1",
                        },
                        {
                          stringValue: "tag-2",
                        },
                      ],
                    },
                  },
                },
                {
                  key: "llm.input_messages.0.message.role",
                  value: {
                    stringValue: "system",
                  },
                },
                {
                  key: "llm.input_messages.0.message.content",
                  value: {
                    stringValue:
                      "You are a helpful assistant that only reply in short tweet-like responses, using lots of emojis.",
                  },
                },
                {
                  key: "llm.input_messages.1.message.role",
                  value: {
                    stringValue: "user",
                  },
                },
                {
                  key: "llm.input_messages.1.message.content",
                  value: {
                    stringValue: "hi",
                  },
                },
                {
                  key: "llm.model_name",
                  value: {
                    stringValue: "gpt-4o-mini-2024-07-18",
                  },
                },
                {
                  key: "llm.output_messages.0.message.role",
                  value: {
                    stringValue: "assistant",
                  },
                },
                {
                  key: "llm.output_messages.0.message.content",
                  value: {
                    stringValue: "Hey there! 😊👋 What’s up? 🌟",
                  },
                },
              ],
              events: [
                {
                  timeUnixNano: "1722809514030552000",
                  name: "First Token Stream Event",
                },
              ],
              status: {
                code: "STATUS_CODE_OK",
              },
            },
          ],
        },
      ],
    },
  ],
};

describe("opentelemetry traces receiver", () => {
  it("receives a basic openai trace", async () => {
    const traces = openTelemetryTraceRequestToTracesForCollection(
      openInferenceOpenAIRequest
    );

    expect(traces).toHaveLength(1);

    const trace = traces[0];

    try {
      z.array(spanSchema).parse(trace.spans);
    } catch (error) {
      const validationError = fromZodError(error as ZodError);
      console.log("trace", JSON.stringify(trace, undefined, 2));
      console.log("validationError", validationError);
      assert.fail(validationError.message);
    }

    expect(trace).toEqual({
      traceId: "03cb2eb84dd52ac9bc1496a99c733880",
      spans: [
        {
          span_id: "9ba2191a84c9a891",
          trace_id: "03cb2eb84dd52ac9bc1496a99c733880",
          name: "ChatCompletion",
          type: "llm",
          model: "gpt-4o-mini-2024-07-18",
          input: {
            type: "chat_messages",
            value: [
              {
                role: "system",
                content:
                  "You are a helpful assistant that only reply in short tweet-like responses, using lots of emojis.",
              },
              {
                role: "user",
                content: "hi",
              },
            ],
          },
          output: {
            type: "chat_messages",
            value: [
              {
                role: "assistant",
                content: "Hey there! 😊👋 What’s up? 🌟",
              },
            ],
          },
          params: {
            model: "gpt-4o-mini",
            stream: true,
            scope: {
              name: "openinference.instrumentation.openai",
              version: "0.1.12",
            },
          },
          timestamps: {
            started_at: 1722809513564,
            finished_at: 1722809514125,
            first_token_at: 1722809514031,
          },
        },
      ],
      reservedTraceMetadata: {
        user_id: "my-test-user",
        thread_id: "my-test-session",
        labels: ["tag-1", "tag-2"],
      },
      customMetadata: {
        "telemetry.sdk.language": "python",
        "telemetry.sdk.name": "opentelemetry",
        "telemetry.sdk.version": "1.25.0",
        "service.name": "unknown_service",
        foo: "bar",
      },
    });
  });
});
