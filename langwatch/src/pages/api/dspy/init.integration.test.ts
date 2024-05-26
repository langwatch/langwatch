import type { Project } from "@prisma/client";
import { type NextApiRequest, type NextApiResponse } from "next";
import { createMocks } from "node-mocks-http";
import { beforeAll, describe, expect, test } from "vitest";
import { prisma } from "../../../server/db";
import { getTestProject } from "../../../utils/testUtils";
import handler from "./init";

const sampleDSPyInitParams = {
  experiment_slug: "test-dspy-init",
};

describe("Init API Endpoint", () => {
  let project: Project;

  beforeAll(async () => {
    project = await getTestProject("dspy-init");

    const allProjects = await prisma.project.findMany();

    await prisma.experiment.deleteMany({
      where: {
        projectId: {
          in: allProjects.map((p) => p.id),
        },
        slug: sampleDSPyInitParams.experiment_slug,
      },
    });
  });

  test("should create experiment and insert DSPyStep into Elasticsearch, appending the examples and llm_calls together, without duplication", async () => {
    const { req, res }: { req: NextApiRequest; res: NextApiResponse } =
      createMocks({
        method: "POST",
        headers: {
          "X-Auth-Token": project.apiKey,
        },
        body: sampleDSPyInitParams,
      });

    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect((res as any)._getJSONData()).toEqual({
      path: `/${project.slug}/experiments/${sampleDSPyInitParams.experiment_slug}`,
    });

    const experiment = await prisma.experiment.findUnique({
      where: {
        projectId_slug: {
          projectId: project.id,
          slug: sampleDSPyInitParams.experiment_slug,
        },
      },
    });
    expect(experiment).not.toBeNull();
  });
});
