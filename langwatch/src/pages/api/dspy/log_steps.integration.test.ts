import { type NextApiRequest, type NextApiResponse } from "next";
import { createMocks } from "node-mocks-http";
import { beforeAll, describe, expect, test } from "vitest";
import handler from "./log_steps";
import { prisma } from "../../../server/db";
import {
  esClient,
  DSPY_STEPS_INDEX,
  dspyStepIndexId,
} from "../../../server/elasticsearch";
import {
  type DSPyStep,
  type DSPyStepRESTParams,
} from "../../../server/experiments/types";
import { getTestProject } from "../../../utils/testUtils";
import type { Project } from "@prisma/client";

const sampleDSPyStep: DSPyStepRESTParams = {
  experiment_slug: "sample-experiment",
  run_id: "run_1",
  index: "0",
  score: 0.5,
  label: "score",
  optimizer: { name: "foo", parameters: { key: "value" } },
  predictors: [{ name: "bar", predictor: { key: "value" } }],
  examples: [
    {
      example: { key: "example_value" },
      pred: { key: "pred_value" },
      score: 0.5,
      trace: [
        {
          input: { key: "input_value" },
          pred: { key: "pred_value" },
        },
      ],
    },
  ],
  llm_calls: [
    {
      __class__: "dsp.modules.gpt3.GPT3",
      response: {
        id: "chatcmpl-9S8MEYRnY4KEgF1FTq3kato6D1cxc",
        choices: [
          {
            finish_reason: "stop",
            index: 0,
            logprobs: null,
            message: {
              content: null,
              role: "assistant",
              function_call: null,
              tool_calls: [
                {
                  id: "call_c8K7jq5C27O5l0vybyGF2MrB",
                  function: {
                    arguments: '{"sentiment":"very_positive"}',
                    name: "sentiment",
                  },
                  type: "function",
                },
              ],
            },
          },
        ],
        created: 1716492338,
        model: "gpt-3.5-turbo-0125",
        object: "chat.completion",
        system_fingerprint: null,
        usage: { completion_tokens: 7, prompt_tokens: 282, total_tokens: 289 },
      },
    },
  ],
  timestamps: {
    created_at: Date.now(),
  },
};

const sampleDSPyStepSecondExampleAndLLMCall: DSPyStepRESTParams = {
  experiment_slug: "sample-experiment",
  run_id: "run_1",
  index: "0",
  score: 0.5,
  label: "score",
  optimizer: { name: "foo", parameters: { key: "value" } },
  predictors: [{ name: "bar", predictor: { key: "value" } }],
  examples: [
    {
      example: { key: "example_value2" },
      pred: { key: "pred_value2" },
      score: 0.5,
      trace: [
        {
          input: { key: "input_value2" },
          pred: { key: "pred_value2" },
        },
      ],
    },
  ],
  llm_calls: [
    {
      __class__: "dsp.modules.gpt3.GPT3",
      response: {
        id: "chatcmpl-9S8MEYRnY4KEgF1FTq3kato6D1cxd",
        choices: [
          {
            finish_reason: "stop",
            index: 0,
            logprobs: null,
            message: {
              content: "hi, how is it going?",
              role: "assistant",
              function_call: null,
              tool_calls: null,
            },
          },
        ],
        created: 1716492338,
        model: "gpt-3.5-turbo-0125",
        object: "chat.completion",
        system_fingerprint: null,
        usage: { completion_tokens: 7, prompt_tokens: 282, total_tokens: 289 },
      },
    },
  ],
  timestamps: {
    created_at: Date.now(),
  },
};

describe("Log Steps API Endpoint", () => {
  let project: Project;

  beforeAll(async () => {
    project = await getTestProject("dspy-log-steps");

    const allProjects = await prisma.project.findMany();

    await prisma.experiment.deleteMany({
      where: {
        projectId: {
          in: allProjects.map((p) => p.id),
        },
        slug: sampleDSPyStep.experiment_slug ?? undefined,
      },
    });

    const client = await esClient({ test: true });
    await client.deleteByQuery({
      index: DSPY_STEPS_INDEX.alias,
      query: {
        match: {
          project_id: project.id,
        },
      },
    });
  });

  test("should create experiment and insert DSPyStep into Elasticsearch, appending the examples and llm_calls together, without duplication, and updating the score", async () => {
    const { req, res }: { req: NextApiRequest; res: NextApiResponse } =
      createMocks<NextApiRequest, NextApiResponse>({
        method: "POST",
        headers: {
          "X-Auth-Token": project.apiKey,
        },
        body: [
          sampleDSPyStep,
          sampleDSPyStepSecondExampleAndLLMCall,
          { ...sampleDSPyStep, score: 0.6 },
        ],
      });

    await handler(req, res);
    expect(res.statusCode).toBe(200);

    const experiment = await prisma.experiment.findUnique({
      where: {
        projectId_slug: {
          projectId: project.id,
          slug: sampleDSPyStep.experiment_slug as string,
        },
      },
    });
    expect(experiment).not.toBeNull();

    const client = await esClient({ test: true });
    const indexedStep = await client.get<DSPyStep>({
      index: DSPY_STEPS_INDEX.alias,
      id: dspyStepIndexId({
        projectId: project.id,
        runId: sampleDSPyStep.run_id,
        index: sampleDSPyStep.index,
      }),
    });
    expect(indexedStep).not.toBeNull();
    expect(indexedStep._source?.score).toEqual(0.6);
    expect(indexedStep._source?.examples).toHaveLength(2);

    expect(indexedStep._source?.llm_calls[0]?.model).toEqual(
      "gpt-3.5-turbo-0125"
    );
    expect(indexedStep._source?.llm_calls[0]?.cost).toBeGreaterThan(0);
  });
});
