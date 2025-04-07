import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST } from "./route";

import * as root from "@opentelemetry/otlp-transformer/build/src/generated/root";
import type { Project } from "@prisma/client";
import type { CollectorJob } from "../../../../../server/background/types";
import { startCollectorWorker } from "../../../../../server/background/workers/collectorWorker";
import {
  esClient,
  TRACE_INDEX,
  traceIndexId,
} from "../../../../../server/elasticsearch";
import { getTestProject, waitForResult } from "../../../../../utils/testUtils";
import type { Worker } from "bullmq";
import * as crypto from "crypto";
import type { ElasticSearchTrace } from "../../../../../server/tracer/types";
import { DEFAULT_EMBEDDINGS_MODEL } from "../../../../../server/embeddings";

const traceRequestType = (root as any).opentelemetry.proto.collector.trace.v1
  .ExportTraceServiceRequest;

describe("opentelemetry traces receiver", () => {
  let worker: Worker<CollectorJob, void, string> | undefined;
  let project: Project | undefined;

  beforeAll(async () => {
    project = await getTestProject("collect");

    const client = await esClient();
    await client.deleteByQuery({
      index: TRACE_INDEX.alias,
      body: {
        query: {
          match: {
            project_id: project.id,
          },
        },
      },
    });

    worker = startCollectorWorker();
    await worker?.waitUntilReady();
  });

  afterAll(async () => {
    await worker?.close();
  });

  const traceId = crypto.randomBytes(16).toString("hex");
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
                traceId: Buffer.from(traceId, "hex").toString("base64"),
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

  it("receives a basic openai trace", async () => {
    const client = await esClient();
    const encodedMessage = traceRequestType.encode(request).finish();
    const uint8Array = new Uint8Array(encodedMessage);
    const blob = new Blob([uint8Array], { type: "application/x-protobuf" });

    const response = await POST(
      new NextRequest("http://localhost:5560/api/otel/v1/trace", {
        method: "POST",
        body: blob,
        headers: {
          "Content-Type": "application/x-protobuf",
          Authorization: `Bearer ${project?.apiKey}`,
        },
      })
    );

    expect(response.status).toBe(200);

    const indexedTrace = await waitForResult(() =>
      client.getSource<ElasticSearchTrace>({
        index: TRACE_INDEX.alias,
        id: traceIndexId({
          traceId,
          projectId: project?.id ?? "",
        }),
      })
    );

    expect(indexedTrace).toEqual({
      trace_id: traceId,
      project_id: project?.id,
      metadata: {
        custom: {
          "service.name": "unknown_service",
          "telemetry.sdk.language": "python",
          "telemetry.sdk.name": "opentelemetry",
          "telemetry.sdk.version": "1.25.0",
        },
        all_keys: expect.arrayContaining([
          "telemetry.sdk.language",
          "telemetry.sdk.name",
          "telemetry.sdk.version",
        ]),
      },
      timestamps: {
        started_at: expect.any(Number),
        inserted_at: expect.any(Number),
        updated_at: expect.any(Number),
      },
      input: expect.objectContaining({
        value: "hi",
        embeddings: {
          embeddings: expect.any(Array),
          model: DEFAULT_EMBEDDINGS_MODEL,
        },
      }),
      output: {
        value: "Hey there! 😊👋 What’s up? 🌟",
        embeddings: {
          embeddings: expect.any(Array),
          model: DEFAULT_EMBEDDINGS_MODEL,
        },
      },
      metrics: {
        completion_tokens: 15,
        total_cost: 0.000012,
        prompt_tokens: 20,
        tokens_estimated: true,
        first_token_ms: 467,
        total_time_ms: 561,
      },
      error: null,
      indexing_md5s: expect.any(Array),

      spans: [
        {
          project_id: project?.id,
          span_id: "9ba2191a84c9a891",
          trace_id: traceId,
          name: "ChatCompletion",
          type: "llm",
          model: "gpt-4o-mini-2024-07-18",
          input: {
            type: "chat_messages",
            value: JSON.stringify([
              {
                role: "system",
                content:
                  "You are a helpful assistant that only reply in short tweet-like responses, using lots of emojis.",
              },
              {
                role: "user",
                content: "hi",
              },
            ]),
          },
          output: {
            type: "chat_messages",
            value: JSON.stringify([
              {
                role: "assistant",
                content: "Hey there! 😊👋 What’s up? 🌟",
              },
            ]),
          },
          metrics: {
            completion_tokens: 15,
            cost: 0.000012,
            prompt_tokens: 20,
            tokens_estimated: true,
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
            inserted_at: expect.any(Number),
            updated_at: expect.any(Number),
          },
        },
      ],
    });
  });

  it("receives a json trace too", async () => {
    const response = await POST(
      new NextRequest("http://localhost:5560/api/otel/v1/trace", {
        method: "POST",
        body: JSON.stringify(request),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${project?.apiKey}`,
        },
      })
    );

    expect(response.status).toBe(200);
  });
});
