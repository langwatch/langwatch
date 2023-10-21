import handler from "./collector";
import { createMocks } from "node-mocks-http";
import { describe, test, expect, beforeAll } from "vitest";
import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "../../server/db";
import { Span, type BaseSpan } from "../../server/tracer/types";
import { SPAN_INDEX, esClient } from "../../server/elasticsearch";

const sampleSpan: BaseSpan = {
  type: "span",
  name: "sample-span",
  span_id: "span_V1StGXR8_Z5jdHi6B-myT",
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

    const indexedSpan = await esClient.getSource<Span>({
      index: SPAN_INDEX,
      id: sampleSpan.span_id,
    });

    expect(indexedSpan).toMatchObject(sampleSpan);
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

  // TODO: Add more tests like checking for valid/invalid tokens, successful insertion, etc.
});
