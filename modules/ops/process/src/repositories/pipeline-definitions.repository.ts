import type { SealedPipelineDefinition } from "@langwatch/eventing";

/** The pipeline definitions this process registered, read when asked rather than at boot. */
export abstract class PipelineDefinitionsRepository {
  abstract findAll(): readonly SealedPipelineDefinition[];
}
