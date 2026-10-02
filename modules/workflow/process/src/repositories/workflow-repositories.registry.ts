import { defineRepositories } from "@langwatch/process";
import type { ObjectStorage } from "@langwatch/process-stores/members";

import type { NlpLambdaArnCache } from "../app/workflow.app.ts";
import type { NlpPayloadStaging } from "../channels/nlp-lambda.channel.ts";
import { MemoryWorkflowRepositories } from "./memory/memory.workflow.repositories.ts";
import { ObjectStorageNlpPayloadStagingRepository } from "./object-storage/object-storage.nlp-payload-staging.repository.ts";
import {
  PostgresWorkflowRepositories,
  type WorkflowPrismaDatabase,
} from "./prisma/prisma.workflow.repositories.ts";
import {
  RedisNlpLambdaArnRepository,
  type NlpLambdaArnRedis,
} from "./redis/redis.nlp-lambda-arn.repository.ts";
import type { WorkflowLineageRepository } from "./workflow-lineage.repository.ts";
import type { WorkflowRowRepository } from "./workflow-row.repository.ts";
import type { WorkflowRepository } from "./workflow.repository.ts";

/**
 * The rows the workflow module owns, chosen once at boot: the graph and its versions, the
 * bare row a Studio copy lands in, and its lineage and publication flags. Postgres holds
 * them when composed; the memory tier holds them otherwise.
 */
export interface WorkflowRepositories {
  readonly workflows: WorkflowRepository;
  readonly workflowRows: WorkflowRowRepository;
  readonly lineage: WorkflowLineageRepository;
  /** Each project's resolved studio function, shared cluster-wide. */
  readonly nlpLambdaArns: NlpLambdaArnCache;
  /** Oversized engine payloads, parked while their invoke is in flight. */
  readonly payloadStaging: NlpPayloadStaging;
}

/** Postgres rows beside the shared ARN cache in Redis and staged payloads in object storage. */
const liveWorkflowRepositories = {
  requires: ["prisma", "redis", "objectStorage"] as const,
  create: (
    members: Readonly<{
      prisma: WorkflowPrismaDatabase;
      redis: NlpLambdaArnRedis;
      objectStorage: ObjectStorage;
    }>,
  ): WorkflowRepositories => ({
    ...PostgresWorkflowRepositories.create({ prisma: members.prisma }),
    nlpLambdaArns: RedisNlpLambdaArnRepository.create({ redis: members.redis }),
    payloadStaging: ObjectStorageNlpPayloadStagingRepository.create({
      objectStorage: members.objectStorage,
    }),
  }),
};

export const workflowRepositories = defineRepositories({
  live: liveWorkflowRepositories,
  memory: MemoryWorkflowRepositories,
});
