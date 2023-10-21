import { type NextApiRequest, type NextApiResponse } from "next";
import { createMocks } from "node-mocks-http";
import { beforeAll, describe, expect, test } from "vitest";
import { prisma } from "../../server/db";
import { SPAN_INDEX, TRACE_INDEX, esClient } from "../../server/elasticsearch";
import {
  type Trace,
  type BaseSpan,
  type ElasticSearchSpan,
} from "../../server/tracer/types";
import handler from "./collector";

const sampleSpan: BaseSpan = {
  type: "span",
  name: "sample-span",
  id: "span_V1StGXR8_Z5jdHi6B-myZ",
  parent_id: null,
  trace_id: "trace_Uakgb_J5m9g-0JDMbcJqLJ",
  input: { type: "text", value: "hello" },
  outputs: [{ type: "text", value: "world" }],
  error: null,
  timestamps: {
    started_at: Date.now(),
    finished_at: Date.now() + 10,
  },
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
    const spanData = {
      spans: [sampleSpan],
    };

    const { req, res }: { req: NextApiRequest; res: NextApiResponse } =
      createMocks({
        method: "POST",
        headers: {
          "X-Auth-Token": "test-auth-token",
        },
        body: spanData,
      });

    await handler(req, res);
    expect(res.statusCode).toBe(200);

    const indexedSpan = await esClient.getSource<ElasticSearchSpan>({
      index: SPAN_INDEX,
      id: sampleSpan.id,
    });

    expect(indexedSpan).toMatchObject(sampleSpan);
    expect(indexedSpan.project_id).toBe(projectId);

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
      },
      output: {
        value: "world",
      },
      metrics: {
        first_token_ms: null,
        total_time_ms: expect.any(Number),
        prompt_tokens: null,
        completion_tokens: null,
        total_cost: null,
      },
      error: null,
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
});
