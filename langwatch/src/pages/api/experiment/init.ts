import { type NextApiRequest, type NextApiResponse } from "next";
import { fromZodError, type ZodError } from "zod-validation-error";
import { prisma } from "~/server/db";

import { createLogger } from "../../../utils/logger";

import {
  type Experiment,
  type ExperimentType,
  type Project,
} from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { nanoid } from "nanoid";
import { z } from "zod";
import { slugify } from "~/utils/slugify";

const logger = createLogger("langwatch:dspy:init");

const dspyInitParamsSchema = z
  .object({
    experiment_id: z.string().optional().nullable(),
    experiment_slug: z.string().optional().nullable(),
    experiment_type: z.enum([
      "DSPY",
      "BATCH_EVALUATION",
      "BATCH_EVALUATION_V2",
    ]),
    experiment_name: z.string().optional(),
    workflowId: z.string().optional(),
  })
  .refine((data) => {
    if (!data.experiment_id && !data.experiment_slug) {
      return false;
    }
    return true;
  });

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

  let params: z.infer<typeof dspyInitParamsSchema>;
  try {
    params = dspyInitParamsSchema.parse(req.body);
  } catch (error) {
    logger.error({ error, body: req.body, projectId: project.id }, 'invalid init data received');
    // TODO: should it be a warning instead of exception on sentry? here and all over our APIs
    Sentry.captureException(error, { extra: { projectId: project.id } });

    const validationError = fromZodError(error as ZodError);
    return res.status(400).json({ error: validationError.message });
  }

  const experiment = await findOrCreateExperiment({
    project,
    experiment_slug: params.experiment_slug,
    experiment_type: params.experiment_type,
    experiment_name: params.experiment_name,
    workflowId: params.workflowId,
  });

  return res.status(200).json({
    path: `/${project.slug}/experiments/${experiment.slug}`,
    slug: experiment.slug,
  });
}

export const findOrCreateExperiment = async ({
  project,
  experiment_id,
  experiment_slug,
  experiment_type,
  experiment_name,
  workflowId,
}: {
  project: Project;
  experiment_id?: string | null;
  experiment_slug?: string | null;
  experiment_type: ExperimentType;
  experiment_name?: string;
  workflowId?: string;
}) => {
  let experiment: Experiment | null = null;

  if (experiment_id) {
    experiment = await prisma.experiment.findUnique({
      where: { projectId: project.id, id: experiment_id },
    });
    if (!experiment) {
      throw new Error("Experiment not found");
    }
  }

  let slug_ = null;
  if (experiment_slug) {
    slug_ = slugify(experiment_slug);
    experiment = await prisma.experiment.findUnique({
      where: { projectId_slug: { projectId: project.id, slug: slug_ } },
    });
  }

  if (!experiment && !slug_) {
    throw new Error("Either experiment_id or experiment_slug is required");
  }

  if (!experiment && slug_) {
    experiment = await prisma.experiment.create({
      data: {
        id: `experiment_${nanoid()}`,
        name: experiment_name ?? experiment_slug,
        slug: slug_,
        projectId: project.id,
        type: experiment_type,
        workflowId: workflowId,
      },
    });
  } else if (experiment) {
    if (!!experiment_name || !!workflowId) {
      await prisma.experiment.update({
        where: { id: experiment.id, projectId: project.id },
        data: { name: experiment_name, workflowId: workflowId },
      });
    }
  } else {
    throw new Error("Experiment not found");
  }
  return experiment;
};
