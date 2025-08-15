import { type ExperimentType, type Project, type Experiment } from "@prisma/client";
import { createLogger } from "~/utils/logger";
import { type ExperimentRepository } from "./repositories/experiment.repository";

const logger = createLogger("langwatch:experiments:experiment-service");

type FindOrCreateExperimentOptions = {
  project: Project;
  experiment_id?: string | null;
  experiment_slug?: string | null;
  experiment_type: ExperimentType;
  experiment_name?: string;
  workflowId?: string;
};

export interface ExperimentService {
  findOrCreateExperiment(options: FindOrCreateExperimentOptions): Promise<Experiment>;
}

export class PrismaExperimentService implements ExperimentService {
  constructor(private readonly experimentRepository: ExperimentRepository) {}

  async findOrCreateExperiment(options: FindOrCreateExperimentOptions): Promise<Experiment> {
    const { project, experiment_id, experiment_slug, experiment_type, experiment_name, workflowId } = options;
    
    logger.info(
      { 
        projectId: project.id, 
        experiment_id, 
        experiment_slug, 
        experiment_type,
        experiment_name,
        workflowId 
      }, 
      "Finding or creating experiment"
    );

    const experiment = await this.experimentRepository.findOrCreateExperiment({
      project,
      experiment_id,
      experiment_slug,
      experiment_type,
      experiment_name,
      workflowId,
    });

    logger.info(
      { 
        projectId: project.id, 
        experimentId: experiment.id,
        experimentSlug: experiment.slug 
      }, 
      "Experiment found or created successfully"
    );

    return experiment;
  }
}
