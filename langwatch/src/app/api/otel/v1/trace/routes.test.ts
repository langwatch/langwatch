import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { POST } from "./route";

import * as root from "@opentelemetry/otlp-transformer/build/src/generated/root";

const traceRequestType = (root as any).opentelemetry.proto.collector.trace.v1
  .ExportTraceServiceRequest;

describe("opentelemetry traces receiver", () => {
  it("receives a basic openai trace", async () => {
    const request = {
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

    const encodedMessage = traceRequestType.encode(request).finish();
    const uint8Array = new Uint8Array(encodedMessage);
    const blob = new Blob([uint8Array], { type: "application/x-protobuf" });

    const response = await POST(
      new NextRequest("http://localhost:3000/api/otel/v1/trace", {
        method: "POST",
        body: blob,
        headers: {
          "Content-Type": "application/x-protobuf",
        },
      })
    );

    expect(response.status).toBe(200);
  });
});
