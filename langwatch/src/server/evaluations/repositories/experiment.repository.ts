import { createLogger } from "~/utils/logger";
import { prisma } from "~/server/db";
import { type ExperimentType, type Project, type Experiment } from "@prisma/client";
import { nanoid } from "nanoid";
import { slugify } from "~/utils/slugify";

const logger = createLogger("langwatch:evaluations:experiment-repository");

export interface ExperimentRepository {
  findOrCreateExperiment(options: {
    projectId: string;
    experiment_id?: string | null;
    experiment_slug?: string | null;
    experiment_type: ExperimentType;
    experiment_name?: string;
    workflowId?: string;
  }): Promise<Experiment>;
}

export class PrismaExperimentRepository implements ExperimentRepository {
  async findOrCreateExperiment(options: {
    projectId: string;
    experiment_id?: string | null;
    experiment_slug?: string | null;
    experiment_type: ExperimentType;
    experiment_name?: string;
    workflowId?: string;
  }): Promise<Experiment> {
    const { projectId, experiment_id, experiment_slug, experiment_type, experiment_name, workflowId } = options;
    
    let experiment: Experiment | null = null;

    if (experiment_id) {
      experiment = await prisma.experiment.findUnique({
        where: { projectId, id: experiment_id },
      });
      if (!experiment) {
        throw new Error("Experiment not found");
      }
    }

    let slug_ = null;
    if (experiment_slug) {
      slug_ = slugify(experiment_slug);
      experiment = await prisma.experiment.findUnique({
        where: { projectId_slug: { projectId, slug: slug_ } },
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
          projectId,
          type: experiment_type,
          workflowId: workflowId,
        },
      });
    } else if (experiment) {
      if (!!experiment_name || !!workflowId) {
        experiment = await prisma.experiment.update({
          where: { id: experiment.id, projectId },
          data: { name: experiment_name, workflowId: workflowId },
        });
      }
    }
    
    if (!experiment) {
      throw new Error("Failed to find or create experiment");
    }
    return experiment;
  }
}
