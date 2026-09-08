import { featureApi } from "@langwatch/runtime-composition";
import type { Experiment, ExperimentLookup, ExperimentSlugLookup } from "./experiment.ts";

/** Callable capability exposed by the composed Experiment application. */
export interface ExperimentApi {
  getById(input: ExperimentLookup): Promise<Experiment>;
  tryGetBySlug(input: ExperimentSlugLookup): Promise<Experiment | null>;
}

export const ExperimentApi = featureApi<ExperimentApi>("experiment");
