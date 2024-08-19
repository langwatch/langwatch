import { type NextApiRequest, type NextApiResponse } from "next";
import { fromZodError, type ZodError } from "zod-validation-error";
import { prisma } from "../../../server/db";

import { getDebugger } from "../../../utils/logger";

import { ExperimentType, type Project } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import crypto from "crypto";
import { z } from "zod";
import {
  estimateCost,
  matchingLLMModelCost,
} from "../../../server/background/workers/collector/cost";
import {
  DSPY_STEPS_INDEX,
  dspyStepIndexId,
  esClient,
} from "../../../server/elasticsearch";
import type {
  DSPyLLMCall,
  DSPyStep,
  DSPyStepRESTParams,
} from "../../../server/experiments/types";
import {
  dSPyStepRESTParamsSchema,
  dSPyStepSchema,
} from "../../../server/experiments/types.generated";
import { findOrCreateExperiment } from "../experiment/init";
import {
  getLLMModelCosts,
  type MaybeStoredLLMModelCost,
} from "../../../server/modelProviders/llmModelCost";

export const debug = getDebugger("langwatch:dspy:log_steps");

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "20mb",
    },
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).end(); // Only accept POST requests
  }

  const authToken = req.headers["x-auth-token"];

  if (!authToken) {
    return res
      .status(401)
      .json({ message: "X-Auth-Token header is required." });
  }

  const project = await prisma.project.findUnique({
    where: { apiKey: authToken as string },
  });

  if (!project) {
    return res.status(401).json({ message: "Invalid auth token." });
  }

  let params: DSPyStepRESTParams[];
  try {
    params = z.array(dSPyStepRESTParamsSchema).parse(req.body);
  } catch (error) {
    debug(
      "Invalid log_steps data received",
      error,
      JSON.stringify(req.body, null, "  "),
      { projectId: project.id }
    );
    // TODO: should it be a warning instead of exception on sentry? here and all over our APIs
    Sentry.captureException(error, { extra: { projectId: project.id } });

    const validationError = fromZodError(error as ZodError);
    return res.status(400).json({ error: validationError.message });
  }

  for (const param of params) {
    if (
      param.timestamps.created_at &&
      param.timestamps.created_at.toString().length === 10
    ) {
      debug(
        "Timestamps not in milliseconds for step",
        param.index,
        "run",
        param.run_id,
        "on experiment",
        param.experiment_slug
      );
      return res.status(400).json({
        error:
          "Timestamps should be in milliseconds not in seconds, please multiply it by 1000",
      });
    }
  }

  for (const param of params) {
    try {
      await processDSPyStep(project, param);
    } catch (error) {
      if (error instanceof z.ZodError) {
        debug(
          "Failed to validate data for DSPy step",
          error,
          JSON.stringify(param, null, "  ")
        );
        Sentry.captureException(error, { extra: { projectId: project.id } });

        const validationError = fromZodError(error as ZodError);
        return res.status(400).json({ error: validationError.message });
      }
    }
  }

  return res.status(200).json({ message: "ok" });
}

const processDSPyStep = async (project: Project, param: DSPyStepRESTParams) => {
  const { run_id, index, experiment_slug } = param;

  const experiment = await findOrCreateExperiment(
    project,
    experiment_slug,
    ExperimentType.DSPY
  );

  const id = dspyStepIndexId({
    projectId: project.id,
    runId: run_id,
    index,
  });

  const llmModelCosts = await getLLMModelCosts({ projectId: project.id });

  const dspyStep: DSPyStep = {
    ...param,
    experiment_id: experiment.id,
    project_id: project.id,
    timestamps: {
      created_at: param.timestamps.created_at,
      inserted_at: new Date().getTime(),
      updated_at: new Date().getTime(),
    },
    examples: param.examples.map((example) => ({
      ...example,
      hash: generateHash(example),
    })),
    llm_calls: param.llm_calls
      .map((call) => ({
        ...call,
        hash: generateHash(call),
      }))
      .map(extractLLMCallInfo(llmModelCosts)),
  };

  // To guarantee no extra keys
  const validatedDspyStep = dSPyStepSchema.parse(dspyStep);

  const script = {
    source: `
      if (ctx._source.examples == null) {
        ctx._source.examples = [];
      }
      for (newExample in params.new_examples) {
        boolean exists = false;
        for (e in ctx._source.examples) {
          if (e.hash == newExample.hash) {
            exists = true;
            break;
          }
        }
        if (!exists) {
          ctx._source.examples.add(newExample);
        }
      }

      if (ctx._source.llm_calls == null) {
        ctx._source.llm_calls = [];
      }
      for (newLLMCall in params.new_llm_calls) {
        boolean exists = false;
        for (call in ctx._source.llm_calls) {
          if (call.hash == newLLMCall.hash) {
            exists = true;
            break;
          }
        }
        if (!exists) {
          ctx._source.llm_calls.add(newLLMCall);
        }
      }

      ctx._source.score = params.new_score;
      ctx._source.timestamps.updated_at = params.updated_at;
    `,
    params: {
      new_examples: validatedDspyStep.examples,
      new_llm_calls: validatedDspyStep.llm_calls,
      new_score: validatedDspyStep.score,
      updated_at: new Date().getTime(),
    },
  };

  await esClient.update({
    index: DSPY_STEPS_INDEX.alias,
    id,
    body: {
      script,
      upsert: validatedDspyStep,
    },
    retry_on_conflict: 5,
  });
};

const generateHash = (data: object) => {
  return crypto.createHash("md5").update(JSON.stringify(data)).digest("hex");
};

const extractLLMCallInfo =
  (llmModelCosts: MaybeStoredLLMModelCost[]) =>
  (call: DSPyLLMCall): DSPyLLMCall => {
    if (
      call.__class__ === "dsp.modules.gpt3.GPT3" ||
      call.response?.object === "chat.completion"
    ) {
      const model = call.response?.model;
      const llmModelCost =
        model && matchingLLMModelCost(call.response.model, llmModelCosts);
      const promptTokens = call.response?.usage?.prompt_tokens;
      const completionTokens = call.response?.usage?.completion_tokens;

      const cost =
        llmModelCost &&
        estimateCost({
          llmModelCost,
          inputTokens: promptTokens ?? 0,
          outputTokens: completionTokens ?? 0,
        });

      return {
        ...call,
        model,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        cost,
      };
    }

    return call;
  };
