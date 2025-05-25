// @ts-ignore
import {
  type ESpanKind,
  type EStatusCode,
  type IEvent,
  type IExportTraceServiceRequest,
} from "@opentelemetry/otlp-transformer";
import { assert, describe, expect, it } from "vitest";
import { z, type ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import type { DeepPartial } from "../../utils/types";
import { openTelemetryTraceRequestToTracesForCollection } from "./opentelemetry";
import { spanSchema } from "./types.generated";

const openInferenceOpenAIRequest: DeepPartial<IExportTraceServiceRequest> = {
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
              kind: "SPAN_KIND_INTERNAL" as unknown as ESpanKind,
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
                      '{"choices": [{"message": {"content": "Hey there! 😊👋 What\'s up? 🌟", "role": "assistant"}, "index": 0, "finish_reason": "stop"}], "id": "chatcmpl-9sdk9jAOO21SHl5mgTZSXVdCVJhDq", "created": 1722809513, "model": "gpt-4o-mini-2024-07-18", "object": "chat.completion.chunk", "system_fingerprint": "fp_611b667b19"}',
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
                    stringValue: "Hey there! 😊👋 What's up? 🌟",
                  },
                },
              ],
              events: [
                {
                  timeUnixNano: "1722809514030552000",
                  name: "First Token Stream Event",
                },
              ] as IEvent[],
              status: {
                code: "STATUS_CODE_OK" as unknown as EStatusCode,
              },
            },
          ],
        },
      ],
    },
  ],
};

const openllmetryOpenAIRequest: DeepPartial<IExportTraceServiceRequest> = {
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
              kind: "SPAN_KIND_CLIENT" as unknown as ESpanKind,
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
                  key: "gen_ai.completion.0.role",
                  value: {
                    stringValue: "assistant",
                  },
                },
                {
                  key: "gen_ai.completion.0.content",
                  value: {
                    stringValue: "Hey there! 😊 What's on your mind? 💬✨",
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
              ] as IEvent[],
              status: {
                code: "STATUS_CODE_OK" as unknown as EStatusCode,
              },
            },
          ],
        },
      ],
    },
  ],
};

const fastApiOpenTelemetryRequest: DeepPartial<IExportTraceServiceRequest> = {
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
            name: "opentelemetry.instrumentation.fastapi",
            version: "0.47b0",
          },
          spans: [
            {
              traceId: "mLt2CryyC2bSMDv62DoncQ==",
              spanId: "hZJ04MHH3MI=",
              parentSpanId: "ABb1CmFM02M=",
              name: "POST / http send",
              kind: "SPAN_KIND_INTERNAL" as unknown as ESpanKind,
              startTimeUnixNano: "1722946507515216000",
              endTimeUnixNano: "1722946509073605000",
              attributes: [
                {
                  key: "asgi.event.type",
                  value: {
                    stringValue: "http.response.body",
                  },
                },
              ],
              status: {},
            },
          ],
        },
      ],
    },
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
            name: "opentelemetry.instrumentation.fastapi",
            version: "0.47b0",
          },
          spans: [
            {
              traceId: "mLt2CryyC2bSMDv62DoncQ==",
              spanId: "ABb1CmFM02M=",
              name: "POST /",
              kind: "SPAN_KIND_SERVER" as unknown as ESpanKind,
              startTimeUnixNano: "1722942373770026000",
              endTimeUnixNano: "1722942375147931000",
              attributes: [
                {
                  key: "http.scheme",
                  value: {
                    stringValue: "http",
                  },
                },
                {
                  key: "http.host",
                  value: {
                    stringValue: "127.0.0.1:8000",
                  },
                },
                {
                  key: "net.host.port",
                  value: {
                    intValue: "8000" as unknown as number,
                  },
                },
                {
                  key: "http.flavor",
                  value: {
                    stringValue: "1.1",
                  },
                },
                {
                  key: "http.target",
                  value: {
                    stringValue: "/",
                  },
                },
                {
                  key: "http.url",
                  value: {
                    stringValue: "http://127.0.0.1:8000/",
                  },
                },
                {
                  key: "http.method",
                  value: {
                    stringValue: "POST",
                  },
                },
                {
                  key: "http.server_name",
                  value: {
                    stringValue: "0.0.0.0:8000",
                  },
                },
                {
                  key: "http.user_agent",
                  value: {
                    stringValue:
                      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0",
                  },
                },
                {
                  key: "net.peer.ip",
                  value: {
                    stringValue: "127.0.0.1",
                  },
                },
                {
                  key: "net.peer.port",
                  value: {
                    intValue: "63047" as unknown as number,
                  },
                },
                {
                  key: "http.route",
                  value: {
                    stringValue: "/",
                  },
                },
                {
                  key: "http.status_code",
                  value: {
                    intValue: {
                      low: 404,
                      high: 0,
                      unsigned: false,
                    } as any,
                  },
                },
              ],
              status: {},
            },
          ],
        },
      ],
    },
  ],
};

const traceWithException: DeepPartial<IExportTraceServiceRequest> = {
  resourceSpans: [
    {
      resource: {
        attributes: [
          {
            key: "service.name",
            value: {
              stringValue: "fastapi_sample_endpoint",
            },
          },
        ],
      },
      scopeSpans: [
        {
          scope: {
            name: "opentelemetry.instrumentation.fastapi",
            version: "0.47b0",
          },
          spans: [
            {
              traceId: "1SNx9GTvt0O0YyRUSGOwew==",
              spanId: "7ok1RgTVkrg=",
              name: "POST /",
              kind: "SPAN_KIND_SERVER" as unknown as ESpanKind,
              startTimeUnixNano: "1722958611402254000",
              endTimeUnixNano: "1722958616308867000",
              attributes: [
                {
                  key: "http.scheme",
                  value: {
                    stringValue: "http",
                  },
                },
                {
                  key: "http.host",
                  value: {
                    stringValue: "127.0.0.1:8000",
                  },
                },
                {
                  key: "net.host.port",
                  value: {
                    intValue: 8000,
                  },
                },
                {
                  key: "http.flavor",
                  value: {
                    stringValue: "1.1",
                  },
                },
                {
                  key: "http.target",
                  value: {
                    stringValue: "/",
                  },
                },
                {
                  key: "http.url",
                  value: {
                    stringValue: "http://127.0.0.1:8000/",
                  },
                },
                {
                  key: "http.method",
                  value: {
                    stringValue: "POST",
                  },
                },
                {
                  key: "http.server_name",
                  value: {
                    stringValue: "0.0.0.0:8000",
                  },
                },
                {
                  key: "http.user_agent",
                  value: {
                    stringValue:
                      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0",
                  },
                },
                {
                  key: "net.peer.ip",
                  value: {
                    stringValue: "127.0.0.1",
                  },
                },
                {
                  key: "net.peer.port",
                  value: {
                    intValue: 55903,
                  },
                },
                {
                  key: "http.route",
                  value: {
                    stringValue: "/",
                  },
                },
              ],
              events: [
                {
                  timeUnixNano: "1722958616308696000",
                  name: "exception",
                  attributes: [
                    {
                      key: "exception.type",
                      value: {
                        stringValue: "Exception",
                      },
                    },
                    {
                      key: "exception.message",
                      value: {
                        stringValue: "BROKEN",
                      },
                    },
                    {
                      key: "exception.stacktrace",
                      value: {
                        stringValue:
                          'Traceback (most recent call last):\n  File "/Users/rchaves/Projects/langwatch-saas/langwatch/python-sdk/.venv/lib/python3.9/site-packages/opentelemetry/trace/__init__.py", line 583, in use_span\n    yield span\n  File "/Users/rchaves/Projects/langwatch-saas/langwatch/python-sdk/.venv/lib/python3.9/site-packages/opentelemetry/instrumentation/asgi/__init__.py", line 731, in __call__\n    await self.app(scope, otel_receive, otel_send)\n  File "/Users/rchaves/Projects/langwatch-saas/langwatch/python-sdk/.venv/lib/python3.9/site-packages/starlette/middleware/exceptions.py", line 79, in __call__\n    raise exc\n  File "/Users/rchaves/Projects/langwatch-saas/langwatch/python-sdk/.venv/lib/python3.9/site-packages/starlette/middleware/exceptions.py", line 68, in __call__\n    await self.app(scope, receive, sender)\n  File "/Users/rchaves/Projects/langwatch-saas/langwatch/python-sdk/.venv/lib/python3.9/site-packages/fastapi/middleware/asyncexitstack.py", line 20, in __call__\n    raise e\n  File "/Users/rchaves/Projects/langwatch-saas/langwatch/python-sdk/.venv/lib/python3.9/site-packages/fastapi/middleware/asyncexitstack.py", line 17, in __call__\n    await self.app(scope, receive, send)\n  File "/Users/rchaves/Projects/langwatch-saas/langwatch/python-sdk/.venv/lib/python3.9/site-packages/starlette/routing.py", line 718, in __call__\n    await route.handle(scope, receive, send)\n  File "/Users/rchaves/Projects/langwatch-saas/langwatch/python-sdk/.venv/lib/python3.9/site-packages/starlette/routing.py", line 276, in handle\n    await self.app(scope, receive, send)\n  File "/Users/rchaves/Projects/langwatch-saas/langwatch/python-sdk/.venv/lib/python3.9/site-packages/starlette/routing.py", line 66, in app\n    response = await func(request)\n  File "/Users/rchaves/Projects/langwatch-saas/langwatch/python-sdk/.venv/lib/python3.9/site-packages/fastapi/routing.py", line 273, in app\n    raw_response = await run_endpoint_function(\n  File "/Users/rchaves/Projects/langwatch-saas/langwatch/python-sdk/.venv/lib/python3.9/site-packages/fastapi/routing.py", line 192, in run_endpoint_function\n    return await run_in_threadpool(dependant.call, **values)\n  File "/Users/rchaves/Projects/langwatch-saas/langwatch/python-sdk/.venv/lib/python3.9/site-packages/starlette/concurrency.py", line 41, in run_in_threadpool\n    return await anyio.to_thread.run_sync(func, *args)\n  File "/Users/rchaves/Projects/langwatch-saas/langwatch/python-sdk/.venv/lib/python3.9/site-packages/anyio/to_thread.py", line 33, in run_sync\n    return await get_asynclib().run_sync_in_worker_thread(\n  File "/Users/rchaves/Projects/langwatch-saas/langwatch/python-sdk/.venv/lib/python3.9/site-packages/anyio/_backends/_asyncio.py", line 877, in run_sync_in_worker_thread\n    return await future\n  File "/Users/rchaves/Projects/langwatch-saas/langwatch/python-sdk/.venv/lib/python3.9/site-packages/anyio/_backends/_asyncio.py", line 807, in run\n    result = context.run(func, *args)\n  File "/Users/rchaves/Projects/langwatch-saas/langwatch/python-sdk/examples/opentelemetry/traditional_instrumentation_fastapi_app.py", line 50, in fastapi_sample_endpoint\n    raise Exception("BROKEN")\nException: BROKEN\n',
                      },
                    },
                    {
                      key: "exception.escaped",
                      value: {
                        stringValue: "False",
                      },
                    },
                  ],
                },
              ],
              status: {
                message: "Exception: BROKEN",
                code: "STATUS_CODE_ERROR" as unknown as EStatusCode,
              },
            },
          ],
        },
      ],
    },
  ],
};

const openllmetryLangChainRequest: DeepPartial<IExportTraceServiceRequest> = {
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
            name: "opentelemetry.instrumentation.langchain",
            version: "0.26.5",
          },
          spans: [
            {
              traceId: "4cmJuE+nwC7cmxIAX8430w==",
              spanId: "S2v3VMCZCUo=",
              name: "RunnableSequence.workflow",
              kind: "SPAN_KIND_INTERNAL" as unknown as ESpanKind,
              startTimeUnixNano: "1723006472661658000",
              endTimeUnixNano: "1723006473946042000",
              attributes: [
                {
                  key: "traceloop.span.kind",
                  value: {
                    stringValue: "workflow",
                  },
                },
                {
                  key: "traceloop.entity.name",
                  value: {
                    stringValue: "RunnableSequence.workflow",
                  },
                },
                {
                  key: "traceloop.entity.input",
                  value: {
                    stringValue:
                      '{"inputs": {"input": ""}, "tags": [], "metadata": {}, "kwargs": {"run_type": null, "name": "RunnableSequence"}}',
                  },
                },
                {
                  key: "traceloop.entity.output",
                  value: {
                    stringValue:
                      '{"outputs": "\\ud83d\\udc4b Hi there! How can I help you today?", "kwargs": {"tags": [], "inputs": {"question": "hello"}}}',
                  },
                },
              ],
              status: {},
            },
          ],
        },
      ],
    },
  ],
};

const strandsTrace: DeepPartial<IExportTraceServiceRequest> = {
  resourceSpans: [
    {
      resource: { attributes: [] },
      scopeSpans: [
        {
          scope: {
            name: "opentelemetry.instrumentation.strands",
          },
          spans: [
            {
              traceId: "4cmJuE+nwC7cmxIAX8430w==",
              spanId: "S2v3VMCZCUo=",
              name: "Model invoke",
              kind: "SPAN_KIND_INTERNAL" as unknown as ESpanKind,
              startTimeUnixNano: "1723006472661658000",
              endTimeUnixNano: "1723006473946042000",
              attributes: [
                {
                  key: "event_loop.cycle_id",
                  value: {
                    stringValue: "29f8679a-3afb-498e-8dc2-643c25434292",
                  },
                },
                {
                  key: "gen_ai.request.model",
                  value: {
                    stringValue: "openai/gpt-4.1-nano",
                  },
                },
                {
                  key: "gen_ai.event.start_time",
                  value: {
                    stringValue: "2025-05-25T10:37:11.068343+00:00",
                  },
                },
                {
                  key: "gen_ai.event.end_time",
                  value: {
                    stringValue: "2025-05-25T10:37:12.014098+00:00",
                  },
                },
                {
                  key: "gen_ai.prompt.0.role",
                  value: {
                    stringValue: "user",
                  },
                },
                {
                  key: "gen_ai.prompt.0.content.0.text",
                  value: {
                    stringValue: "yo",
                  },
                },
                {
                  key: "gen_ai.agent.name",
                  value: {
                    stringValue: "Strands Agent",
                  },
                },
                {
                  key: "gen_ai.completion.0.text",
                  value: {
                    stringValue:
                      "Hello! What would you like to look at or explore today?",
                  },
                },
                {
                  key: "agent.name",
                  value: {
                    stringValue: "Strands Agent",
                  },
                },
                {
                  key: "gen_ai.usage.prompt_tokens",
                  value: {
                    intValue: 24,
                  },
                },
                {
                  key: "gen_ai.usage.completion_tokens",
                  value: {
                    intValue: 10,
                  },
                },
                {
                  key: "gen_ai.usage.total_tokens",
                  value: {
                    intValue: 34,
                  },
                },
                {
                  key: "scope.name",
                  value: {
                    stringValue: "strands-bot",
                  },
                },
              ],
              status: {},
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
      z.array(spanSchema).parse(trace!.spans);
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
                content: "Hey there! 😊👋 What's up? 🌟",
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
      evaluations: [],
      reservedTraceMetadata: {
        user_id: "my-test-user",
        thread_id: "my-test-session",
        labels: ["tag-1", "tag-2"],
      },
      customMetadata: {
        "service.name": "unknown_service",
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
      z.array(spanSchema).parse(trace!.spans);
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
                content: "Hey there! 😊 What's on your mind? 💬✨",
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
      evaluations: [],
      reservedTraceMetadata: {},
      customMetadata: {
        "service.name": "unknown_service",
        "telemetry.sdk.language": "python",
        "telemetry.sdk.name": "opentelemetry",
        "telemetry.sdk.version": "1.26.0",
      },
    });
  });

  it("receives traditional opentelemetry trace for fastapi", async () => {
    const traces = openTelemetryTraceRequestToTracesForCollection(
      fastApiOpenTelemetryRequest
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
      traceId: "98bb760abcb20b66d2303bfad83a2771",
      spans: [
        {
          span_id: "859274e0c1c7dcc2",
          trace_id: "98bb760abcb20b66d2303bfad83a2771",
          parent_id: "0016f50a614cd363",
          name: "POST / http send",
          type: "span",
          input: null,
          output: null,
          params: {
            asgi: {
              event: {
                type: "http.response.body",
              },
            },
            scope: {
              name: "opentelemetry.instrumentation.fastapi",
              version: "0.47b0",
            },
          },
          timestamps: {
            started_at: 1722946507515,
            finished_at: 1722946509074,
          },
        },
        {
          span_id: "0016f50a614cd363",
          trace_id: "98bb760abcb20b66d2303bfad83a2771",
          name: "POST /",
          type: "server",
          input: null,
          output: null,
          params: {
            http: {
              scheme: "http",
              host: "127.0.0.1:8000",
              flavor: 1.1,
              target: "/",
              url: "http://127.0.0.1:8000/",
              method: "POST",
              server_name: "0.0.0.0:8000",
              user_agent:
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0",
              route: "/",
              status_code: 404,
            },
            net: {
              host: {
                port: "8000",
              },
              peer: {
                ip: "127.0.0.1",
                port: "63047",
              },
            },
            scope: {
              name: "opentelemetry.instrumentation.fastapi",
              version: "0.47b0",
            },
          },
          timestamps: {
            started_at: 1722942373770,
            finished_at: 1722942375148,
          },
        },
      ],
      evaluations: [],
      reservedTraceMetadata: {},
      customMetadata: {
        "service.name": "unknown_service",
        "telemetry.sdk.language": "python",
        "telemetry.sdk.name": "opentelemetry",
        "telemetry.sdk.version": "1.26.0",
      },
    });
  });

  it("receives a trace with an exception", async () => {
    const traces =
      openTelemetryTraceRequestToTracesForCollection(traceWithException);

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
      traceId: "d52371f464efb743b46324544863b07b",
      spans: [
        {
          span_id: "ee89354604d592b8",
          trace_id: "d52371f464efb743b46324544863b07b",
          name: "POST /",
          type: "server",
          input: null,
          output: null,
          error: {
            has_error: true,
            message: "Exception: BROKEN",
            stacktrace: [
              "Traceback (most recent call last):",
              '  File "/Users/rchaves/Projects/langwatch-saas/langwatch/python-sdk/.venv/lib/python3.9/site-packages/opentelemetry/trace/__init__.py", line 583, in use_span',
              "    yield span",
              '  File "/Users/rchaves/Projects/langwatch-saas/langwatch/python-sdk/.venv/lib/python3.9/site-packages/opentelemetry/instrumentation/asgi/__init__.py", line 731, in __call__',
              "    await self.app(scope, otel_receive, otel_send)",
              '  File "/Users/rchaves/Projects/langwatch-saas/langwatch/python-sdk/.venv/lib/python3.9/site-packages/starlette/middleware/exceptions.py", line 79, in __call__',
              "    raise exc",
              '  File "/Users/rchaves/Projects/langwatch-saas/langwatch/python-sdk/.venv/lib/python3.9/site-packages/starlette/middleware/exceptions.py", line 68, in __call__',
              "    await self.app(scope, receive, sender)",
              '  File "/Users/rchaves/Projects/langwatch-saas/langwatch/python-sdk/.venv/lib/python3.9/site-packages/fastapi/middleware/asyncexitstack.py", line 20, in __call__',
              "    raise e",
              '  File "/Users/rchaves/Projects/langwatch-saas/langwatch/python-sdk/.venv/lib/python3.9/site-packages/fastapi/middleware/asyncexitstack.py", line 17, in __call__',
              "    await self.app(scope, receive, send)",
              '  File "/Users/rchaves/Projects/langwatch-saas/langwatch/python-sdk/.venv/lib/python3.9/site-packages/starlette/routing.py", line 718, in __call__',
              "    await route.handle(scope, receive, send)",
              '  File "/Users/rchaves/Projects/langwatch-saas/langwatch/python-sdk/.venv/lib/python3.9/site-packages/starlette/routing.py", line 276, in handle',
              "    await self.app(scope, receive, send)",
              '  File "/Users/rchaves/Projects/langwatch-saas/langwatch/python-sdk/.venv/lib/python3.9/site-packages/starlette/routing.py", line 66, in app',
              "    response = await func(request)",
              '  File "/Users/rchaves/Projects/langwatch-saas/langwatch/python-sdk/.venv/lib/python3.9/site-packages/fastapi/routing.py", line 273, in app',
              "    raw_response = await run_endpoint_function(",
              '  File "/Users/rchaves/Projects/langwatch-saas/langwatch/python-sdk/.venv/lib/python3.9/site-packages/fastapi/routing.py", line 192, in run_endpoint_function',
              "    return await run_in_threadpool(dependant.call, **values)",
              '  File "/Users/rchaves/Projects/langwatch-saas/langwatch/python-sdk/.venv/lib/python3.9/site-packages/starlette/concurrency.py", line 41, in run_in_threadpool',
              "    return await anyio.to_thread.run_sync(func, *args)",
              '  File "/Users/rchaves/Projects/langwatch-saas/langwatch/python-sdk/.venv/lib/python3.9/site-packages/anyio/to_thread.py", line 33, in run_sync',
              "    return await get_asynclib().run_sync_in_worker_thread(",
              '  File "/Users/rchaves/Projects/langwatch-saas/langwatch/python-sdk/.venv/lib/python3.9/site-packages/anyio/_backends/_asyncio.py", line 877, in run_sync_in_worker_thread',
              "    return await future",
              '  File "/Users/rchaves/Projects/langwatch-saas/langwatch/python-sdk/.venv/lib/python3.9/site-packages/anyio/_backends/_asyncio.py", line 807, in run',
              "    result = context.run(func, *args)",
              '  File "/Users/rchaves/Projects/langwatch-saas/langwatch/python-sdk/examples/opentelemetry/traditional_instrumentation_fastapi_app.py", line 50, in fastapi_sample_endpoint',
              '    raise Exception("BROKEN")',
              "Exception: BROKEN",
              "",
            ],
          },
          params: {
            http: {
              scheme: "http",
              host: "127.0.0.1:8000",
              flavor: 1.1,
              target: "/",
              url: "http://127.0.0.1:8000/",
              method: "POST",
              server_name: "0.0.0.0:8000",
              user_agent:
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0",
              route: "/",
            },
            net: {
              host: {
                port: 8000,
              },
              peer: {
                ip: "127.0.0.1",
                port: 55903,
              },
            },
            scope: {
              name: "opentelemetry.instrumentation.fastapi",
              version: "0.47b0",
            },
          },
          timestamps: {
            started_at: 1722958611402,
            finished_at: 1722958616309,
          },
        },
      ],
      evaluations: [],
      reservedTraceMetadata: {},
      customMetadata: {
        "service.name": "fastapi_sample_endpoint",
      },
    });
  });

  it("receives a langchain openlllmetry trace", async () => {
    const traces = openTelemetryTraceRequestToTracesForCollection(
      openllmetryLangChainRequest
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
      traceId: "e1c989b84fa7c02edc9b12005fce37d3",
      spans: [
        {
          span_id: "4b6bf754c099094a",
          trace_id: "e1c989b84fa7c02edc9b12005fce37d3",
          name: "RunnableSequence.workflow",
          type: "workflow",
          input: {
            type: "json",
            value: {
              inputs: {
                input: "",
              },
              tags: [],
              metadata: [],
              kwargs: {
                run_type: null,
                name: "RunnableSequence",
              },
            },
          },
          output: {
            type: "json",
            value: {
              outputs: "👋 Hi there! How can I help you today?",
              kwargs: {
                tags: [],
                inputs: {
                  question: "hello",
                },
              },
            },
          },
          params: {
            traceloop: {
              entity: {
                name: "RunnableSequence.workflow",
              },
            },
            scope: {
              name: "opentelemetry.instrumentation.langchain",
              version: "0.26.5",
            },
          },
          timestamps: {
            started_at: 1723006472662,
            finished_at: 1723006473946,
          },
        },
      ],
      evaluations: [],
      reservedTraceMetadata: {},
      customMetadata: {
        "telemetry.sdk.language": "python",
        "telemetry.sdk.name": "opentelemetry",
        "telemetry.sdk.version": "1.26.0",
        "service.name": "unknown_service",
      },
    });
  });

  it("receives a strands trace", async () => {
    const traces = openTelemetryTraceRequestToTracesForCollection(strandsTrace);

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
      traceId: "e1c989b84fa7c02edc9b12005fce37d3",
      spans: [
        {
          span_id: "4b6bf754c099094a",
          trace_id: "e1c989b84fa7c02edc9b12005fce37d3",
          name: "Model invoke",
          type: "agent",
          input: {
            type: "chat_messages",
            value: [
              {
                role: "user",
                content: [
                  {
                    text: "yo",
                  },
                ],
              },
            ],
          },
          output: {
            type: "json",
            value: [
              {
                text: "Hello! What would you like to look at or explore today?",
              },
            ],
          },
          model: "openai/gpt-4.1-nano",
          metrics: {
            prompt_tokens: 24,
            completion_tokens: 10,
          },
          params: {
            event_loop: {
              cycle_id: "29f8679a-3afb-498e-8dc2-643c25434292",
            },
            gen_ai: {
              event: {
                start_time: "2025-05-25T10:37:11.068343+00:00",
                end_time: "2025-05-25T10:37:12.014098+00:00",
              },
              agent: {
                name: "Strands Agent",
              },
              usage: {
                total_tokens: 34,
              },
            },
            agent: {
              name: "Strands Agent",
            },
            scope: {
              name: "opentelemetry.instrumentation.strands",
            },
          },
          timestamps: {
            started_at: 1723006472662,
            finished_at: 1723006473946,
          },
        },
      ],
      evaluations: [],
      reservedTraceMetadata: {},
      customMetadata: {},
    });
  });
});
