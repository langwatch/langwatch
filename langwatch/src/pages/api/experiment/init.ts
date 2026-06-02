import type { Experiment, ExperimentType, Project } from "@prisma/client";
import { nanoid } from "nanoid";
import { z } from "zod";
import { fromZodError, type ZodError } from "zod-validation-error";
import {
  apiKeyCeilingDenialResponse,
  enforceApiKeyCeiling,
  extractCredentials,
} from "~/server/api-key/auth-middleware";
import { TokenResolver } from "~/server/api-key/token-resolver";
import { prisma } from "~/server/db";
import { ExperimentService } from "~/server/experiments/experiment.service";
import type { NextApiRequest, NextApiResponse } from "~/types/next-stubs";
import { captureException } from "~/utils/posthogErrorCapture";
import { slugify } from "~/utils/slugify";
import { createLogger } from "../../../utils/logger/server";

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
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).end(); // Only accept POST requests
  }

  const credentials = extractCredentials((name) => {
    const value = req.headers[name.toLowerCase()];
    if (Array.isArray(value)) return value[0];
    return value ?? undefined;
  });
  if (!credentials) {
    return res.status(401).json({
      message:
        "Authentication token is required. Use X-Auth-Token header, Authorization: Bearer token, or Authorization: Basic base64(projectId:token).",
    });
  }

  const tokenResolver = TokenResolver.create(prisma);
  const resolved = await tokenResolver.resolve({
    token: credentials.token,
    projectId: credentials.projectId,
  });
  if (!resolved) {
    return res.status(401).json({ message: "Invalid auth token." });
  }

  // Experiments carry their own RBAC permission, decoupled from workflows:
  // initializing an experiment run requires `experiments:manage`.
  try {
    await enforceApiKeyCeiling({
      prisma,
      resolved,
      permission: "experiments:manage",
    });
  } catch (error) {
    const denial = apiKeyCeilingDenialResponse(error);
    return res.status(denial.status).json({ message: denial.message });
  }

  const project = resolved.project;

  let params: z.infer<typeof dspyInitParamsSchema>;
  try {
    params = dspyInitParamsSchema.parse(req.body);
  } catch (error) {
    logger.error(
      { error, body: req.body, projectId: project.id },
      "invalid init data received",
    );
    // TODO: should it be a warning instead of exception on sentry? here and all over our APIs
    captureException(error, { extra: { projectId: project.id } });

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

  // Late markUsed: response has been fully built, the API key was genuinely used
  // for a successful request. Fire-and-forget; a DB hiccup must not mask the
  // experiment creation.
  if (resolved.type === "apiKey") {
    tokenResolver.markUsed({ apiKeyId: resolved.apiKeyId });
  }

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
  const experiments = ExperimentService.create(prisma);

  if (experiment_id) {
    experiment = await experiments.findById({
      projectId: project.id,
      id: experiment_id,
    });
    if (!experiment) {
      throw new Error("Experiment not found");
    }
  }

  let slug_ = null;
  if (experiment_slug) {
    slug_ = slugify(experiment_slug);
    // findBySlug filters archivedAt at the service layer. Archived rows
    // also have a `-archived-<nanoid>` slug, so they would not collide
    // even on a raw findUnique - we still go through the service so the
    // archive rule stays one source of truth.
    experiment = await experiments.findBySlug({
      projectId: project.id,
      slug: slug_,
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
