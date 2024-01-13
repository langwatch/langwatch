import { type NextApiRequest, type NextApiResponse } from "next";
import { createMocks } from "node-mocks-http";
import { beforeAll, describe, expect, test } from "vitest";
import { prisma } from "../../server/db";
import { SPAN_INDEX, TRACE_INDEX, esClient } from "../../server/elasticsearch";
import {
  type Trace,
  type ElasticSearchSpan,
  type LLMSpan,
  type RAGSpan,
  type CollectorRESTParams,
} from "../../server/tracer/types";
import handler from "./collector";

const sampleSpan: LLMSpan = {
  type: "llm",
  name: "sample-span",
  id: "span_V1StGXR8_Z5jdHi6B-myB",
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
    started_at: Date.now(),
    finished_at: Date.now() + 10,
  },
  vendor: "openai",
  model: "gpt-3.5-turbo",
  params: {},
  metrics: {},
};

describe("Collector API Endpoint", () => {
  // TODO: add project id
  let projectId: string | undefined;

  beforeAll(async () => {
    await prisma.project.deleteMany({
      where: { slug: "--test-project" },
    });
    const project = await prisma.project.create({
      data: {
        name: "Test Project",
        slug: "--test-project",
        language: "python",
        framework: "openai",
        apiKey: "test-auth-token",
        teamId: "some-team",
      },
    });
    projectId = project.id;
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
          "X-Auth-Token": "test-auth-token",
        },
        body: traceData,
      });

    await handler(req, res);
    expect(res.statusCode).toBe(200);

    const indexedSpan = await esClient.getSource<ElasticSearchSpan>({
      index: SPAN_INDEX,
      id: sampleSpan.id,
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
      project_id: projectId,
      raw_response: null,
    });

    const indexedTrace = await esClient.getSource<Trace>({
      index: TRACE_INDEX,
      id: sampleSpan.trace_id,
    });

    expect(indexedTrace).toEqual({
      id: sampleSpan.trace_id,
      project_id: projectId,
      timestamps: {
        started_at: expect.any(Number),
        inserted_at: expect.any(Number),
      },
      input: {
        value: "hello",
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
          "X-Auth-Token": "test-auth-token",
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
      id: "span_V1StGXR8_Z5jdHi6B-myE",
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
      id: "span_V1StGXR8_Z5jdHi6B-myF",
      parent_id: ragSpan.id,
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
          "X-Auth-Token": "test-auth-token",
        },
        body: traceData,
      });

    await handler(req, res);
    expect(res.statusCode).toBe(200);

    const indexedRagSpan = await esClient.getSource<ElasticSearchSpan>({
      index: SPAN_INDEX,
      id: ragSpan.id,
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
        { id: "context-1", content: "France is a country in Europe." },
        { id: "context-2", content: "Paris is the capital of France." },
      ],
      project_id: projectId,
    });
  });

  test("should insert text-only RAG contexts too for backwards-compatibility", async () => {
    const traceId = "trace_test-trace_J5m9g-0JDMbcJqLK2";
    const ragSpan: RAGSpan = {
      type: "rag",
      id: "span_V1StGXR8_Z5jdHi6B-myE",
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
      id: "span_V1StGXR8_Z5jdHi6B-myF",
      parent_id: ragSpan.id,
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
          "X-Auth-Token": "test-auth-token",
        },
        body: traceData,
      });

    await handler(req, res);
    expect(res.statusCode).toBe(200);

    const indexedRagSpan = await esClient.getSource<ElasticSearchSpan>({
      index: SPAN_INDEX,
      id: ragSpan.id,
    });

    expect(indexedRagSpan).toMatchObject({
      contexts: [
        { id: expect.any(String), content: '"France is a country in Europe."' },
        {
          id: expect.any(String),
          content: '"Paris is the capital of France."',
        },
      ],
    });
  });

  // TODO: add a PII cleanup test
});
