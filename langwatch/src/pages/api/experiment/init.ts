import { type NextApiRequest, type NextApiResponse } from "next";
import { fromZodError, type ZodError } from "zod-validation-error";
import { prisma } from "../../../server/db";

import { getDebugger } from "../../../utils/logger";

import { type ExperimentType, type Project } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { nanoid } from "nanoid";
import slugify from "slugify";

export const debug = getDebugger("langwatch:dspy:init");

const dspyInitParamsSchema = z.object({
  experiment_slug: z.string(),
  experiment_type: z.enum(["DSPY", "BATCH_EVALUATION"]),
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
    debug(
      "Invalid init data received",
      error,
      JSON.stringify(req.body, null, "  "),
      { projectId: project.id }
    );
    // TODO: should it be a warning instead of exception on sentry? here and all over our APIs
    Sentry.captureException(error, { extra: { projectId: project.id } });

    const validationError = fromZodError(error as ZodError);
    return res.status(400).json({ error: validationError.message });
  }

  const experiment = await findOrCreateExperiment(
    project,
    params.experiment_slug,
    params.experiment_type
  );

  return res
    .status(200)
    .json({ path: `/${project.slug}/experiments/${experiment.slug}` });
}

export const findOrCreateExperiment = async (
  project: Project,
  experiment_slug: string,
  experiment_type: ExperimentType
) => {
  const slug_ = slugify(experiment_slug.replace(/[:\?&]/g, "-"), {
    lower: true,
    strict: true,
    replacement: "-",
  });
  let experiment = await prisma.experiment.findUnique({
    where: { projectId_slug: { projectId: project.id, slug: slug_ } },
  });
  if (!experiment) {
    experiment = await prisma.experiment.create({
      data: {
        id: `experiment_${nanoid()}`,
        name: experiment_slug,
        slug: slug_,
        projectId: project.id,
        type: experiment_type,
      },
    });
  }
  return experiment;
};
