import { type NextApiRequest, type NextApiResponse } from "next";
import { createMocks } from "node-mocks-http";
import { beforeAll, describe, expect, test } from "vitest";
import { prisma } from "../../server/db";
import {
  SPAN_INDEX,
  TRACE_INDEX,
  esClient,
  spanIndexId,
  traceIndexId,
} from "../../server/elasticsearch";
import {
  type Trace,
  type ElasticSearchSpan,
  type LLMSpan,
  type RAGSpan,
  type CollectorRESTParams,
} from "../../server/tracer/types";
import handler from "./collector";
import type { Project } from "@prisma/client";
import { nanoid } from "nanoid";

const sampleSpan: LLMSpan = {
  type: "llm",
  name: "sample-span",
  span_id: "span_V1StGXR8_Z5jdHi6B-myB",
  parent_id: null,
  trace_id: "trace_test-trace_J5m9g-0JDMbcJqLK",
  input: {
    type: "chat_messages",
    value: [
      { role: "system", content: "you are a helpful assistant" },
      { role: "user", content: "hello" },
    ],
  },
  outputs: [{ type: "text", value: "world" }],
  error: null,
  timestamps: {
    started_at: 1706623872769,
    finished_at: 1706623872769 + 10,
  },
  vendor: "openai",
  model: "gpt-3.5-turbo",
  params: {},
  metrics: {},
};

describe("Collector API Endpoint", () => {
  // TODO: add project id
  let project: Project | undefined;

  beforeAll(async () => {
    await prisma.project.deleteMany({
      where: { slug: "--test-project" },
    });
    project = await prisma.project.create({
      data: {
        name: "Test Project",
        slug: "--test-project",
        language: "python",
        framework: "openai",
        apiKey: `test-auth-token-${nanoid()}`,
        teamId: "some-team",
      },
    });
  });

  test("should insert spans into Elasticsearch", async () => {
    const traceData: CollectorRESTParams = {
      trace_id: sampleSpan.trace_id,
      spans: [sampleSpan],
      thread_id: "thread_test-thread_1",
      user_id: "user_test-user_1",
      customer_id: "customer_test-customer_1",
      labels: ["test-label-1.0.0"],
    };

    const { req, res }: { req: NextApiRequest; res: NextApiResponse } =
      createMocks({
        method: "POST",
        headers: {
          "X-Auth-Token": project?.apiKey,
        },
        body: traceData,
      });

    await handler(req, res);
    expect(res.statusCode).toBe(200);

    const indexedSpan = await esClient.getSource<ElasticSearchSpan>({
      index: SPAN_INDEX,
      id: spanIndexId({
        spanId: sampleSpan.span_id,
        projectId: project?.id ?? "",
      }),
      routing: traceIndexId({
        traceId: sampleSpan.trace_id,
        projectId: project?.id ?? "",
      }),
    });

    expect(indexedSpan).toMatchObject({
      ...sampleSpan,
      input: {
        type: "chat_messages",
        value: JSON.stringify(sampleSpan.input?.value),
      },
      outputs: [
        {
          type: "text",
          value: '"world"',
        },
      ],
      project_id: project?.id,
      raw_response: null,
    });

    const indexedTrace = await esClient.getSource<Trace>({
      index: TRACE_INDEX,
      id: traceIndexId({
        traceId: sampleSpan.trace_id,
        projectId: project?.id ?? "",
      }),
    });

    expect(indexedTrace).toEqual({
      trace_id: sampleSpan.trace_id,
      project_id: project?.id,
      timestamps: {
        started_at: expect.any(Number),
        inserted_at: expect.any(Number),
      },
      input: {
        value: "hello",
        satisfaction_score: expect.any(Number),
        openai_embeddings: expect.any(Array),
      },
      output: {
        value: "world",
        openai_embeddings: expect.any(Array),
      },
      search_embeddings: {
        openai_embeddings: expect.any(Array),
      },
      metrics: {
        first_token_ms: null,
        total_time_ms: expect.any(Number),
        prompt_tokens: 7,
        completion_tokens: 1,
        total_cost: 0.0000125,
        tokens_estimated: true,
      },
      error: null,
      thread_id: "thread_test-thread_1",
      user_id: "user_test-user_1",
      customer_id: "customer_test-customer_1",
      labels: ["test-label-1.0.0"],
      indexing_md5s: ["702375442be05a005a7dffc756bdf10b"],
    });
  });

  test("should return 405 for non-POST requests", async () => {
    const { req, res }: { req: NextApiRequest; res: NextApiResponse } =
      createMocks({
        method: "GET",
      });
    await handler(req, res);

    expect(res.statusCode).toBe(405);
  });

  test("should return 401 when X-Auth-Token header is missing", async () => {
    const { req, res }: { req: NextApiRequest; res: NextApiResponse } =
      createMocks({
        method: "POST",
      });
    await handler(req, res);

    expect(res.statusCode).toBe(401);
  });

  test("should return 400 for invalid span format", async () => {
    const invalidSpan = {
      type: "invalidType",
      name: "TestName",
      id: "1234",
    };

    const { req, res }: { req: NextApiRequest; res: NextApiResponse } =
      createMocks({
        method: "POST",
        headers: {
          "X-Auth-Token": project?.apiKey,
        },
        body: {
          spans: [invalidSpan],
        },
      });
    await handler(req, res);

    expect(res.statusCode).toBe(400);
  });

  test("should insert RAGs, extracting the input and output from children spans if not available", async () => {
    const traceId = "trace_test-trace_J5m9g-0JDMbcJqLK2";
    const ragSpan: RAGSpan = {
      type: "rag",
      span_id: "span_V1StGXR8_Z5jdHi6B-myE",
      trace_id: traceId,
      contexts: [
        { document_id: "context-1", content: "France is a country in Europe." },
        {
          document_id: "context-2",
          chunk_id: 1 as any, // check if api allow for numbers
          content: "Paris is the capital of France.",
        },
      ],
      outputs: [],
      timestamps: sampleSpan.timestamps,
    };
    const llmSpan: LLMSpan = {
      ...sampleSpan,
      span_id: "span_V1StGXR8_Z5jdHi6B-myF",
      parent_id: ragSpan.span_id,
      trace_id: traceId,
      input: {
        type: "chat_messages",
        value: [
          { role: "system", content: "you are a helpful assistant" },
          { role: "user", content: "What is the capital of France?" },
        ],
      },
      outputs: [
        {
          type: "chat_messages",
          value: [
            { role: "assistant", content: "The capital of France is Paris." },
          ],
        },
      ],
    };

    const traceData: CollectorRESTParams = {
      trace_id: traceId,
      spans: [llmSpan, ragSpan],
    };

    const { req, res }: { req: NextApiRequest; res: NextApiResponse } =
      createMocks({
        method: "POST",
        headers: {
          "X-Auth-Token": project?.apiKey,
        },
        body: traceData,
      });

    await handler(req, res);
    expect(res.statusCode).toBe(200);

    const indexedRagSpan = await esClient.getSource<ElasticSearchSpan>({
      index: SPAN_INDEX,
      id: spanIndexId({
        spanId: ragSpan.span_id,
        projectId: project?.id ?? "",
      }),
      routing: traceIndexId({
        traceId,
        projectId: project?.id ?? "",
      }),
    });

    expect(indexedRagSpan).toMatchObject({
      input: {
        type: "text",
        value: '"What is the capital of France?"',
      },
      outputs: [
        {
          type: "text",
          value: '"The capital of France is Paris."',
        },
      ],
      contexts: [
        { document_id: "context-1", content: "France is a country in Europe." },
        {
          document_id: "context-2",
          content: "Paris is the capital of France.",
        },
      ],
      project_id: project?.id,
    });
  });

  test("should insert text-only RAG contexts too for backwards-compatibility", async () => {
    const traceId = "trace_test-trace_J5m9g-0JDMbcJqLK2";
    const ragSpan: RAGSpan = {
      type: "rag",
      span_id: "span_V1StGXR8_Z5jdHi6B-myE",
      trace_id: traceId,
      contexts: [
        "France is a country in Europe.",
        "Paris is the capital of France.",
      ] as any,
      outputs: [],
      timestamps: sampleSpan.timestamps,
    };
    const llmSpan: LLMSpan = {
      ...sampleSpan,
      span_id: "span_V1StGXR8_Z5jdHi6B-myF",
      parent_id: ragSpan.span_id,
      trace_id: traceId,
      input: {
        type: "chat_messages",
        value: [
          { role: "system", content: "you are a helpful assistant" },
          { role: "user", content: "What is the capital of France?" },
        ],
      },
      outputs: [
        {
          type: "chat_messages",
          value: [
            { role: "assistant", content: "The capital of France is Paris." },
          ],
        },
      ],
    };

    const traceData: CollectorRESTParams = {
      trace_id: traceId,
      spans: [llmSpan, ragSpan],
    };

    const { req, res }: { req: NextApiRequest; res: NextApiResponse } =
      createMocks({
        method: "POST",
        headers: {
          "X-Auth-Token": project?.apiKey,
        },
        body: traceData,
      });

    await handler(req, res);
    expect(res.statusCode).toBe(200);

    const indexedRagSpan = await esClient.getSource<ElasticSearchSpan>({
      index: SPAN_INDEX,
      id: spanIndexId({
        spanId: ragSpan.span_id,
        projectId: project?.id ?? "",
      }),
      routing: traceIndexId({
        traceId,
        projectId: project?.id ?? "",
      }),
    });

    expect(indexedRagSpan.contexts).toMatchObject([
      {
        document_id: expect.any(String),
        content: "France is a country in Europe.",
      },
      {
        document_id: expect.any(String),
        content: "Paris is the capital of France.",
      },
    ]);
  });

  // TODO: add a PII cleanup test
});
