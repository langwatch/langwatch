import type { EventSourcing, SealedPipelineDefinition } from "@langwatch/eventing";

import { PipelineDefinitionsRepository } from "../pipeline-definitions.repository.ts";

/** The definitions the process's eventing member holds; the same member in either tier. */
export class EventingPipelineDefinitionsRepository extends PipelineDefinitionsRepository {
  private constructor(private readonly eventing: Pick<EventSourcing, "definitions">) {
    super();
  }

  static create({
    eventing,
  }: {
    eventing: Pick<EventSourcing, "definitions">;
  }): EventingPipelineDefinitionsRepository {
    return new EventingPipelineDefinitionsRepository(eventing);
  }

  findAll(): readonly SealedPipelineDefinition[] {
    return this.eventing.definitions;
  }
}
