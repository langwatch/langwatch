import type { Experiment, ExperimentType, Project } from "@prisma/client";
import { nanoid } from "nanoid";
import type { NextApiRequest, NextApiResponse } from "~/types/next-stubs";
import { z } from "zod";
import { fromZodError, type ZodError } from "zod-validation-error";
import { prisma } from "~/server/db";
import { createLicenseEnforcementService } from "~/server/license-enforcement";
import { LimitExceededError } from "~/server/license-enforcement/errors";
import { buildResourceLimitMessage } from "~/server/license-enforcement/limit-message";
import {
  enforcePatCeiling,
  extractCredentials,
  patCeilingDenialResponse,
} from "~/server/pat/auth-middleware";
import { TokenResolver } from "~/server/pat/token-resolver";
import { captureException } from "~/utils/posthogErrorCapture";
import { slugify } from "~/utils/slugify";
import { createLogger } from "../../../utils/logger/server";

/**
 * Adapts a Next.js pages-router request to the minimal Hono-shaped surface
 * consumed by `extractCredentials` (`{ req: { header: (name) => string | undefined } }`).
 * Header names are normalised to lowercase because Node gives us a mixed-case
 * record and `extractCredentials` looks up by the canonical lowercase name.
 */
const toHonoHeaderAdapter = (req: NextApiRequest) => ({
  req: {
    header: (name: string): string | undefined => {
      const value = req.headers[name.toLowerCase()];
      if (Array.isArray(value)) return value[0];
      return value ?? undefined;
    },
  },
});

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

  const credentials = extractCredentials(toHonoHeaderAdapter(req));
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

  // TODO(pat): introduce a dedicated `experiments:manage` permission once
  // the RBAC catalog grows beyond workflows. Experiments are created/owned
  // by workflows today, so `workflows:manage` is the closest existing
  // ceiling — VIEWER is correctly blocked, ADMIN/MEMBER pass through.
  try {
    await enforcePatCeiling({
      prisma,
      resolved,
      permission: "workflows:manage",
    });
  } catch (error) {
    const denial = patCeilingDenialResponse(error);
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

  let experiment: Experiment;
  try {
    experiment = await findOrCreateExperiment({
      project,
      experiment_slug: params.experiment_slug,
      experiment_type: params.experiment_type,
      experiment_name: params.experiment_name,
      workflowId: params.workflowId,
    });
  } catch (error) {
    if (error instanceof LimitExceededError) {
      let message = error.message;
      try {
        const organizationId = await resolveOrganizationId(project.teamId);
        if (organizationId) {
          message = await buildResourceLimitMessage({
            organizationId,
            limitType: error.limitType,
            max: error.max,
          });
        }
      } catch {
        logger.warn(
          { projectId: project.id },
          "Failed to build resource limit message",
        );
      }

      return res.status(403).json({
        error: error.kind,
        message,
        limitType: error.limitType,
        current: error.current,
        max: error.max,
      });
    }
    throw error;
  }

  // Late markUsed: response has been fully built, the PAT was genuinely used
  // for a successful request. Fire-and-forget; a DB hiccup must not mask the
  // experiment creation.
  if (resolved.type === "pat") {
    tokenResolver.markUsed({ patId: resolved.patId });
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
    const organizationId = await resolveOrganizationId(project.teamId);
    if (organizationId) {
      const enforcement = createLicenseEnforcementService(prisma);
      await enforcement.enforceLimit(organizationId, "experiments");
    }

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

/**
 * Resolves the organizationId from a teamId.
 * Returns null if the team or organization is not found.
 */
async function resolveOrganizationId(
  teamId: string,
): Promise<string | null> {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { organizationId: true },
  });

  return team?.organizationId ?? null;
}
