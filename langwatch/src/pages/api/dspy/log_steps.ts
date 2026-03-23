import { ExperimentType, type Project } from "@prisma/client";
import crypto from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { fromZodError, type ZodError } from "zod-validation-error";
import { captureException } from "~/utils/posthogErrorCapture";
import {
  estimateCost,
  matchingLLMModelCost,
} from "../../../server/background/workers/collector/cost";
import { prisma } from "../../../server/db";
import type {
  DSPyLLMCall,
  DSPyStepRESTParams,
} from "../../../server/experiments/types";
import {
  dSPyStepRESTParamsSchema,
} from "../../../server/experiments/types.generated";
import { getPayloadSizeHistogram } from "../../../server/metrics";
import {
  getLLMModelCosts,
  type MaybeStoredLLMModelCost,
} from "../../../server/modelProviders/llmModelCost";
import { createLogger } from "../../../utils/logger/server";

import { findOrCreateExperiment } from "../experiment/init";
import { getApp } from "../../../server/app-layer/app";
import type { DspyStepData } from "../../../server/app-layer/dspy-steps/types";

const logger = createLogger("langwatch:dspy_log_steps");

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "20mb",
    },
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
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

  const payloadSize = JSON.stringify(req.body).length;
  const payloadSizeMB = payloadSize / (1024 * 1024);
  getPayloadSizeHistogram("log_steps").observe(payloadSize);

  logger.info(
    {
      payloadSize,
      payloadSizeMB: payloadSizeMB.toFixed(2),
      projectId: project.id,
    },
    "DSPy log_steps request received",
  );

  let params: DSPyStepRESTParams[];
  try {
    params = z.array(dSPyStepRESTParamsSchema).parse(req.body);
  } catch (error) {
    logger.error(
      {
        error,
        payloadSize,
        payloadSizeMB: payloadSizeMB.toFixed(2),
        projectId: project.id,
      },
      "invalid log_steps data received",
    );
    // TODO: should it be a warning instead of exception on sentry? here and all over our APIs
    captureException(error, { extra: { projectId: project.id } });

    const validationError = fromZodError(error as ZodError);
    return res.status(400).json({ error: validationError.message });
  }

  for (const param of params) {
    if (
      param.timestamps.created_at &&
      param.timestamps.created_at.toString().length === 10
    ) {
      logger.error(
        { param, projectId: project.id },
        "timestamps not in milliseconds for step",
      );
      return res.status(400).json({
        error:
          "Timestamps should be in milliseconds not in seconds, please multiply it by 1000",
      });
    }
  }

  logger.info(
    { stepCount: params.length, projectId: project.id },
    "Processing DSPy steps",
  );

  for (const param of params) {
    try {
      await processDSPyStep(project, param);
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.error(
          {
            error,
            stepId: param.index,
            runId: param.run_id,
            projectId: project.id,
          },
          "failed to validate data for DSPy step",
        );
        captureException(error, {
          extra: { projectId: project.id, param },
        });

        const validationError = fromZodError(error as ZodError);
        return res.status(400).json({ error: validationError.message });
      } else {
        logger.error(
          {
            error,
            stepId: param.index,
            runId: param.run_id,
            projectId: project.id,
          },
          "internal server error processing DSPy step",
        );
        captureException(error, {
          extra: { projectId: project.id, param },
        });

        return res.status(500).json({ error: "Internal server error" });
      }
    }
  }

  return res.status(200).json({ message: "ok" });
}

const processDSPyStep = async (project: Project, param: DSPyStepRESTParams) => {
  const { run_id, index, experiment_id, experiment_slug } = param;

  const experiment = await findOrCreateExperiment({
    project,
    experiment_id,
    experiment_slug,
    experiment_type: ExperimentType.DSPY,
  });

  const llmModelCosts = await getLLMModelCosts({ projectId: project.id });

  const now = Date.now();

  let totalSize = 0;
  const examples = param.examples.map((example) => {
    const processedExample = {
      ...{
        ...example,
        trace: example.trace?.map((t) => {
          if (t.input?.contexts && typeof t.input.contexts !== "string") {
            t.input.contexts = JSON.stringify(t.input.contexts);
          }
          return t;
        }),
      },
      hash: generateHash(example),
    };
    return processedExample;
  });

  const llmCalls = param.llm_calls
    .map((call) => ({
      ...call,
      hash: generateHash(call),
    }))
    .map(extractLLMCallInfo(llmModelCosts))
    .map((llmCall) => {
      if (llmCall.response?.output) {
        delete llmCall.response.choices;
      }

      if (llmCall.response) {
        totalSize = JSON.stringify(llmCall).length;

        if (totalSize >= 256_000) {
          llmCall.response.output = "[truncated]";
          llmCall.response.messages = [];
        }
      }

      return llmCall;
    });

  const stepData: DspyStepData = {
    tenantId: project.id,
    experimentId: experiment.id,
    runId: run_id,
    stepIndex: index,
    workflowVersionId: param.workflow_version_id,
    score: param.score,
    label: param.label,
    optimizerName: param.optimizer.name,
    optimizerParameters: param.optimizer.parameters,
    predictors: param.predictors,
    examples,
    llmCalls,
    createdAt: param.timestamps.created_at,
    insertedAt: now,
    updatedAt: now,
  };

  await getApp().dspySteps.steps.upsertStep(stepData);

  logger.info(
    { stepId: param.index, runId: param.run_id, projectId: project.id },
    "Successfully stored DSPy step",
  );
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
