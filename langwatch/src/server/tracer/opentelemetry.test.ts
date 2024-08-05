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

const openllmetryOpenAIRequest: IExportTraceServiceRequest = {
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
              stringValue: "1.26.0",
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
            name: "opentelemetry.instrumentation.openai.v1",
            version: "0.26.4",
          },
          spans: [
            {
              traceId: "hhUJjCxy5yMw6ADvOrHYuA==",
              spanId: "D2n+rs/O1Jg=",
              name: "openai.chat",
              kind: "SPAN_KIND_CLIENT",
              startTimeUnixNano: "1722866602559872000",
              endTimeUnixNano: "1722866604545023000",
              attributes: [
                {
                  key: "llm.request.type",
                  value: {
                    stringValue: "chat",
                  },
                },
                {
                  key: "gen_ai.system",
                  value: {
                    stringValue: "OpenAI",
                  },
                },
                {
                  key: "gen_ai.request.model",
                  value: {
                    stringValue: "gpt-4o-mini",
                  },
                },
                {
                  key: "llm.headers",
                  value: {
                    stringValue: "None",
                  },
                },
                {
                  key: "llm.is_streaming",
                  value: {
                    boolValue: true,
                  },
                },
                {
                  key: "gen_ai.openai.api_base",
                  value: {
                    stringValue: "https://api.openai.com/v1/",
                  },
                },
                {
                  key: "gen_ai.prompt.0.role",
                  value: {
                    stringValue: "system",
                  },
                },
                {
                  key: "gen_ai.prompt.0.content",
                  value: {
                    stringValue:
                      "You are a helpful assistant that only reply in short tweet-like responses, using lots of emojis.",
                  },
                },
                {
                  key: "gen_ai.prompt.1.role",
                  value: {
                    stringValue: "user",
                  },
                },
                {
                  key: "gen_ai.prompt.1.content",
                  value: {
                    stringValue: "yous",
                  },
                },
                {
                  key: "gen_ai.response.model",
                  value: {
                    stringValue: "gpt-4o-mini-2024-07-18",
                  },
                },
                {
                  key: "gen_ai.completion.0.finish_reason",
                  value: {
                    stringValue: "stop",
                  },
                },
                {
                  key: "gen_ai.completion.0.role",
                  value: {
                    stringValue: "assistant",
                  },
                },
                {
                  key: "gen_ai.completion.0.content",
                  value: {
                    stringValue: "Hey there! 😊 What’s on your mind? 💬✨",
                  },
                },
              ],
              events: [
                {
                  timeUnixNano: "1722866604464076000",
                  name: "llm.content.completion.chunk",
                },
                {
                  timeUnixNano: "1722866604487318000",
                  name: "llm.content.completion.chunk",
                },
                {
                  timeUnixNano: "1722866604493170000",
                  name: "llm.content.completion.chunk",
                },
                {
                  timeUnixNano: "1722866604496259000",
                  name: "llm.content.completion.chunk",
                },
                {
                  timeUnixNano: "1722866604498817000",
                  name: "llm.content.completion.chunk",
                },
                {
                  timeUnixNano: "1722866604501262000",
                  name: "llm.content.completion.chunk",
                },
                {
                  timeUnixNano: "1722866604503900000",
                  name: "llm.content.completion.chunk",
                },
                {
                  timeUnixNano: "1722866604506069000",
                  name: "llm.content.completion.chunk",
                },
                {
                  timeUnixNano: "1722866604513677000",
                  name: "llm.content.completion.chunk",
                },
                {
                  timeUnixNano: "1722866604519198000",
                  name: "llm.content.completion.chunk",
                },
                {
                  timeUnixNano: "1722866604524125000",
                  name: "llm.content.completion.chunk",
                },
                {
                  timeUnixNano: "1722866604527675000",
                  name: "llm.content.completion.chunk",
                },
                {
                  timeUnixNano: "1722866604530569000",
                  name: "llm.content.completion.chunk",
                },
                {
                  timeUnixNano: "1722866604540024000",
                  name: "llm.content.completion.chunk",
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
  it("receives a basic openai trace for openinference", async () => {
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
        foo: "bar",
      },
    });
  });

  it("receives a basic openai trace for openllmetry", async () => {
    const traces = openTelemetryTraceRequestToTracesForCollection(
      openllmetryOpenAIRequest
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
      traceId: "8615098c2c72e72330e800ef3ab1d8b8",
      spans: [
        {
          span_id: "0f69feaecfced498",
          trace_id: "8615098c2c72e72330e800ef3ab1d8b8",
          name: "openai.chat",
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
                content: "yous",
              },
            ],
          },
          output: {
            type: "chat_messages",
            value: [
              {
                role: "assistant",
                content: "Hey there! 😊 What’s on your mind? 💬✨",
              },
            ],
          },
          params: {
            stream: true,
            gen_ai: {
              system: "OpenAI",
              openai: {
                api_base: "https://api.openai.com/v1/",
              },
            },
            scope: {
              name: "opentelemetry.instrumentation.openai.v1",
              version: "0.26.4",
            },
          },
          timestamps: {
            started_at: 1722866602560,
            finished_at: 1722866604545,
            first_token_at: 1722866604464,
          },
        },
      ],
      reservedTraceMetadata: {},
      customMetadata: {
        "telemetry.sdk.language": "python",
        "telemetry.sdk.name": "opentelemetry",
        "telemetry.sdk.version": "1.26.0",
      },
    });
  });
});
