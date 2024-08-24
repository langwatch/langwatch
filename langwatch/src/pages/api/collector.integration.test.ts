import { type Project } from "@prisma/client";
import type { Worker } from "bullmq";
import { nanoid } from "nanoid";
import { type NextApiRequest, type NextApiResponse } from "next";
import { createMocks } from "node-mocks-http";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { CollectorJob } from "../../server/background/types";
import { startCollectorWorker } from "../../server/background/workers/collectorWorker";
import {
  TRACE_INDEX,
  esClient,
  traceIndexId,
} from "../../server/elasticsearch";
import { DEFAULT_EMBEDDINGS_MODEL } from "../../server/embeddings";
import {
  type CollectorRESTParams,
  type ElasticSearchTrace,
  type LLMSpan,
  type RAGSpan,
} from "../../server/tracer/types";
import { getTestProject, waitForResult } from "../../utils/testUtils";
import handler from "./collector";

const sampleSpan: LLMSpan = {
  type: "llm",
  name: "sample-span",
  span_id: `span_${nanoid()}`,
  parent_id: null,
  trace_id: `trace_${nanoid()}`,
  input: {
    type: "chat_messages",
    value: [
      { role: "system", content: "you are a helpful assistant" },
      { role: "user", content: "hello" },
    ],
  },
  output: { type: "text", value: "world" },
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
  let worker: Worker<CollectorJob, void, string> | undefined;
  let project: Project | undefined;

  beforeAll(async () => {
    project = await getTestProject("collect");

    await esClient.deleteByQuery({
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

  test("should insert spans into Elasticsearch", async () => {
    const traceData: CollectorRESTParams = {
      trace_id: sampleSpan.trace_id,
      spans: [sampleSpan],
      metadata: {
        thread_id: "thread_test-thread_1",
        user_id: "user_test-user_1",
        customer_id: "customer_test-customer_1",
        labels: ["test-label-1.0.0"],
        my_custom_key: "my_custom_value",
      },
      expected_output: "world",
    };

    const { req, res }: { req: NextApiRequest; res: NextApiResponse } =
      createMocks({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": project?.apiKey,
        },
        body: traceData,
      });

    await handler(req, res);
    expect(res.statusCode).toBe(200);

    const indexedTrace = await waitForResult(async () => {
      const trace = await esClient.getSource<ElasticSearchTrace>({
        index: TRACE_INDEX.alias,
        id: traceIndexId({
          traceId: sampleSpan.trace_id,
          projectId: project?.id ?? "",
        }),
      });

      expect(trace.spans).toBeDefined();

      return trace;
    });

    expect(indexedTrace).toEqual({
      trace_id: sampleSpan.trace_id,
      project_id: project?.id,
      metadata: {
        thread_id: "thread_test-thread_1",
        user_id: "user_test-user_1",
        customer_id: "customer_test-customer_1",
        labels: ["test-label-1.0.0"],
        custom: {
          my_custom_key: "my_custom_value",
        },
        all_keys: expect.arrayContaining([
          "user_id",
          "thread_id",
          "customer_id",
          "labels",
          "my_custom_key",
        ]),
      },
      timestamps: {
        started_at: expect.any(Number),
        inserted_at: expect.any(Number),
        updated_at: expect.any(Number),
      },
      input: expect.objectContaining({
        value: "hello",
        embeddings: {
          embeddings: expect.any(Array),
          model: DEFAULT_EMBEDDINGS_MODEL,
        },
      }),
      output: {
        value: "world",
        embeddings: {
          embeddings: expect.any(Array),
          model: DEFAULT_EMBEDDINGS_MODEL,
        },
      },
      metrics: {
        first_token_ms: null,
        total_time_ms: expect.any(Number),
        prompt_tokens: 7,
        completion_tokens: 1,
        total_cost: 0.0000125,
        tokens_estimated: true,
      },
      expected_output: { value: "world" },
      error: null,
      indexing_md5s: expect.any(Array),

      spans: [
        {
          ...sampleSpan,
          metrics: {
            completion_tokens: 1,
            cost: 0.0000125,
            prompt_tokens: 7,
            tokens_estimated: true,
          },
          input: {
            type: "chat_messages",
            value: JSON.stringify(sampleSpan.input?.value),
          },
          output: {
            type: "text",
            value: '"world"',
          },
          timestamps: {
            ...sampleSpan.timestamps,
            inserted_at: expect.any(Number),
            updated_at: expect.any(Number),
          },
          project_id: project?.id,
        },
      ],
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
          "Content-Type": "application/json",
          "X-Auth-Token": project?.apiKey,
        },
        body: {
          spans: [invalidSpan],
        },
      });
    await handler(req, res);

    expect(res.statusCode).toBe(400);
  });

  test("should return 400 for invalid span format without timestamps", async () => {
    const invalidSpan = {
      metadata: {
        user_id: "",
      },
      spans: [
        {
          contexts: [
            {
              content: "No documents found.",
              document_id: "N/A",
            },
          ],
          input: {
            type: "chat_messages",
            value: [
              {
                content: "hello there",
                role: "user",
              },
            ],
          },
          output: {
            type: "chat_messages",
            value: [
              {
                content: "hi!",
                role: "assistant",
              },
            ],
          },
          span_id: "0faa206c-237b-4c5d-bbf9-47e082a77ff3",
          trace_id: "6e1dd990-6186-4dce-a09a-faaad24d2c7e",
          type: "rag",
        },
      ],
      trace_id: "6e1dd990-6186-4dce-a09a-faaad24d2c7e",
    };

    const { req, res }: { req: NextApiRequest; res: NextApiResponse } =
      createMocks({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
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
    const traceId = `trace_test-${nanoid()}`;
    const ragSpan: RAGSpan = {
      type: "rag",
      span_id: `span_${nanoid()}`,
      trace_id: traceId,
      contexts: [
        { document_id: "context-1", content: "France is a country in Europe." },
        {
          document_id: "context-2",
          chunk_id: 1 as any, // check if api allow for numbers
          content: "Paris is the capital of France.",
        },
      ],
      output: null,
      timestamps: sampleSpan.timestamps,
    };
    const llmSpan: LLMSpan = {
      ...sampleSpan,
      span_id: `span_${nanoid()}`,
      parent_id: ragSpan.span_id,
      trace_id: traceId,
      input: {
        type: "chat_messages",
        value: [
          { role: "system", content: "you are a helpful assistant" },
          { role: "user", content: "What is the capital of France?" },
        ],
      },
      output: {
        type: "chat_messages",
        value: [
          { role: "assistant", content: "The capital of France is Paris." },
        ],
      },
    };

    const traceData: CollectorRESTParams = {
      trace_id: traceId,
      spans: [llmSpan, ragSpan],
    };

    const { req, res }: { req: NextApiRequest; res: NextApiResponse } =
      createMocks({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": project?.apiKey,
        },
        body: traceData,
      });

    await handler(req, res);
    expect(res.statusCode).toBe(200);

    const indexedRagTrace = await waitForResult(async () => {
      const trace = await esClient.getSource<ElasticSearchTrace>({
        index: TRACE_INDEX.alias,
        id: traceIndexId({
          traceId,
          projectId: project?.id ?? "",
        }),
      });

      expect(trace.spans).toBeDefined();

      return trace;
    });

    expect(indexedRagTrace.spans![1]).toMatchObject({
      input: {
        type: "text",
        value: '"What is the capital of France?"',
      },
      output: {
        type: "text",
        value: '"The capital of France is Paris."',
      },
      contexts: [
        {
          document_id: "context-1",
          content: "France is a country in Europe.",
        },
        {
          document_id: "context-2",
          chunk_id: "1",
          content: "Paris is the capital of France.",
        },
      ],
      project_id: project?.id,
    });
  });

  test("should insert text-only RAG contexts too, and outputs as a list, for backwards-compatibility", async () => {
    const traceId = `trace_test-${nanoid()}`;
    const ragSpan: RAGSpan = {
      type: "rag",
      span_id: `span_${nanoid()}`,
      trace_id: traceId,
      contexts: [
        "France is a country in Europe.",
        "Paris is the capital of France.",
      ] as any,
      timestamps: sampleSpan.timestamps,
      // @ts-ignore
      outputs: [],
    };
    const llmSpan: LLMSpan = {
      ...sampleSpan,
      span_id: `span_${nanoid()}`,
      parent_id: ragSpan.span_id,
      trace_id: traceId,
      input: {
        type: "chat_messages",
        value: [
          { role: "system", content: "you are a helpful assistant" },
          { role: "user", content: "What is the capital of France?" },
        ],
      },
      // @ts-ignore
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
          "Content-Type": "application/json",
          "X-Auth-Token": project?.apiKey,
        },
        body: traceData,
      });

    await handler(req, res);
    expect(res.statusCode).toBe(200);

    const indexedRagTrace = await waitForResult(async () => {
      const trace = await esClient.getSource<ElasticSearchTrace>({
        index: TRACE_INDEX.alias,
        id: traceIndexId({
          traceId,
          projectId: project?.id ?? "",
        }),
      });

      expect(trace.spans).toBeDefined();

      return trace;
    });

    expect(indexedRagTrace.spans![1]!.contexts).toMatchObject([
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

  test("cleans up PII", async () => {
    const traceId = `trace_test-${nanoid()}`;
    const traceData: CollectorRESTParams = {
      trace_id: traceId,
      spans: [
        {
          ...sampleSpan,
          trace_id: traceId,
          span_id: `span_${nanoid()}`,
          input: {
            type: "chat_messages",
            value: [
              { role: "system", content: "you are a helpful assistant" },
              {
                role: "user",
                content:
                  "hey there, my email is foo@bar.com, please check it for me",
              },
            ],
          },
        },
      ],
      metadata: {
        thread_id: "thread_test-thread_1",
        user_id: "user_test-user_1",
        customer_id: "customer_test-customer_1",
        labels: ["test-label-1.0.0"],
      },
    };

    const { req, res }: { req: NextApiRequest; res: NextApiResponse } =
      createMocks({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": project?.apiKey,
        },
        body: traceData,
      });

    await handler(req, res);
    expect(res.statusCode).toBe(200);

    const indexedTrace = await waitForResult(() =>
      esClient.getSource<ElasticSearchTrace>({
        index: TRACE_INDEX.alias,
        id: traceIndexId({
          traceId,
          projectId: project?.id ?? "",
        }),
      })
    );

    expect(indexedTrace).toMatchObject({
      input: {
        value: "hey there, my email is [REDACTED], please check it for me",
        // satisfaction_score: expect.any(Number), // Fails if langwatch_nlp is off
        embeddings: {
          embeddings: expect.any(Array),
          model: DEFAULT_EMBEDDINGS_MODEL,
        },
      },
      spans: [
        {
          input: {
            type: "chat_messages",
            value: JSON.stringify([
              { role: "system", content: "you are a helpful assistant" },
              {
                role: "user",
                content:
                  "hey there, my email is [REDACTED], please check it for me",
              },
            ]),
          },
        },
      ],
    });
  });

  test("should insert custom evaluation results as well", async () => {
    const traceId = `trace_test-${nanoid()}`;
    const llmSpan: LLMSpan = {
      ...sampleSpan,
      trace_id: traceId,
      span_id: `span_${nanoid()}`,
    };

    const builtInEvaluationId = `eval_${nanoid()}`;
    const traceData: CollectorRESTParams = {
      trace_id: traceId,
      spans: [llmSpan],
      evaluations: [
        {
          name: "custom evaluation",
          passed: true,
        },
        {
          evaluation_id: builtInEvaluationId,
          name: "built-in evaluation",
          type: "ragas/faithfulness",
          score: 0.5,
        },
      ],
    };

    const { req, res }: { req: NextApiRequest; res: NextApiResponse } =
      createMocks({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": project?.apiKey,
        },
        body: traceData,
      });

    await handler(req, res);
    expect(res.statusCode).toBe(200);

    const indexedTraceWithEvaluations = await waitForResult(async () => {
      const trace = await esClient.getSource<ElasticSearchTrace>({
        index: TRACE_INDEX.alias,
        id: traceIndexId({
          traceId,
          projectId: project?.id ?? "",
        }),
      });

      expect(trace.evaluations).toBeDefined();

      return trace;
    });

    expect(indexedTraceWithEvaluations.evaluations).toMatchObject([
      {
        evaluation_id: expect.any(String),
        evaluator_id: expect.any(String),
        name: "custom evaluation",
        passed: true,
        status: "processed",
        timestamps: {
          inserted_at: expect.any(Number),
          updated_at: expect.any(Number),
        },
      },
      {
        evaluation_id: builtInEvaluationId,
        evaluator_id: expect.any(String),
        name: "built-in evaluation",
        type: "ragas/faithfulness",
        score: 0.5,
        status: "processed",
        timestamps: {
          inserted_at: expect.any(Number),
          updated_at: expect.any(Number),
        },
      },
    ]);
  });
});
