import type { EventSourcing } from "@langwatch/eventing";
import type { ProcessMembers } from "@langwatch/process-stores/members";

import {
  composeIdentityPipeline,
  type IdentityPipeline,
} from "../eventing/user-identity.pipeline.ts";
import { identityPipelineRepositories } from "../repositories/identity-repositories.registry.ts";

/**
 * The identity pipeline for a one-shot process that sends its commands (the tasks runner): the
 * same definition the worker drains, over the module's real rows. Only the draining worker reads
 * them (Alex, 2026-09-27).
 */
export class IdentityProducerPipelines {
  static create(options: {
    database: ProcessMembers["prisma"];
    eventing: Pick<EventSourcing, "getEventStore">;
  }): IdentityProducerPipelines {
    return new IdentityProducerPipelines(options);
  }

  private constructor(
    private readonly options: {
      database: ProcessMembers["prisma"];
      eventing: Pick<EventSourcing, "getEventStore">;
    },
  ) {}

  identityPipeline(): IdentityPipeline {
    return composeIdentityPipeline({ repositories: identityPipelineRepositories(this.options) });
  }
}
