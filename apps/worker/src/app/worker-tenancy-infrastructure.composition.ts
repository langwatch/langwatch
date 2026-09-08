import {
  ApiKeyBindingIdAdapter,
  ApiKeyDiagnosticsAdapter,
  type ApiKeyInfrastructure,
} from "@langwatch/api-key-server";
import {
  EventingAuthzGrantAdapter,
  KsuidAuthzBindingIdAdapter,
  type AuthzGrantsCommandDispatcherPort,
} from "@langwatch/authz-server";
import {
  DataRetentionPlanPort,
  type DataRetentionInfrastructure,
  type DataRetentionPlan,
} from "@langwatch/data-retention-server";
import type { PlanInfo } from "@langwatch/enterprise-licensing-contract";
import { isEnterpriseTier } from "@langwatch/enterprise-plan-gate";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import type { PrismaConnection } from "@langwatch/prisma-client";
import type { ProjectInfrastructure } from "@langwatch/project-server";
import type { RedisConnection } from "@langwatch/redis-client";
import type { ShareInfrastructure } from "@langwatch/share-server";
import type { TopicInfrastructure } from "@langwatch/topic-server";
import { resolveWorkerStoredSecretCipher } from "./worker-automation-graph.composition.ts";
import type { WorkerConfig } from "../platform/config/worker.config.ts";
import type { WorkerTenancyCompositionOptions } from "./worker-tenancy.composition.ts";

/**
 * Substrates the worker root already owns before it declares feature Apps.
 * Eventing supplies both deferred command ports; this factory never creates a
 * second dispatcher or topic command path.
 */
export type WorkerTenancyInfrastructureOptions = Readonly<{
  connection: PrismaConnection;
  redis: RedisConnection | null;
  config: WorkerConfig;
  plans: PlanProvider;
  authzDispatcher: AuthzGrantsCommandDispatcherPort;
  topicClustering: ProjectInfrastructure["topicClustering"];
  topicSchedule: TopicInfrastructure["schedule"];
  dataRetention: Omit<DataRetentionInfrastructure, "redis">;
  logger?: Logger;
}>;

/**
 * The plan behind a retention gate, reduced to the two facts retention tiers
 * on. Which plan types count as enterprise, and whether this install is SaaS at
 * all, are billing and licensing facts the feature deliberately does not know.
 */
export class WorkerDataRetentionPlans extends DataRetentionPlanPort {
  static create(plans: Pick<PlanProvider, "getActivePlan">): WorkerDataRetentionPlans {
    return new WorkerDataRetentionPlans(plans);
  }

  private constructor(private readonly plans: Pick<PlanProvider, "getActivePlan">) {
    super();
  }

  async getPlan(input: {
    organizationId: string;
    userId: string | null;
  }): Promise<DataRetentionPlan> {
    const plan: PlanInfo = await this.plans.getActivePlan({
      organizationId: input.organizationId,
      ...(input.userId ? { user: { id: input.userId } } : {}),
    });

    return { free: plan.free, uncapped: isEnterpriseTier(plan.type) };
  }
}

/**
 * Derives the exact per-feature factory inputs from process substrates. The
 * graph receives its peer APIs from `installWorkerTenancy`; only feature-owned
 * IDs, crypto, repositories, and command adapters are assembled here.
 */
export function createWorkerTenancyInfrastructure(
  options: WorkerTenancyInfrastructureOptions,
): WorkerTenancyCompositionOptions {
  const logger = options.logger ?? createLogger(options.config.serviceName);
  const encryption = resolveWorkerStoredSecretCipher(options.config);
  const authzBindingIds = KsuidAuthzBindingIdAdapter.create();
  const apiKeys: ApiKeyInfrastructure = {
    database: options.connection.client,
    pepper: options.config.apiKeyPepper,
    bindingIds: ApiKeyBindingIdAdapter.create(),
    deriveBindingId: EventingAuthzGrantAdapter.deriveGrantId,
    diagnostics: ApiKeyDiagnosticsAdapter.create(logger),
  };
  const project: Omit<ProjectInfrastructure, "database"> = {
    topicClustering: options.topicClustering,
  };
  const topics: Omit<TopicInfrastructure, "database"> = {
    schedule: options.topicSchedule,
  };
  const share: Omit<ShareInfrastructure, "database" | "redis"> = {};

  return {
    connection: options.connection,
    redis: options.redis,
    logger,
    encryption,
    plans: options.plans,
    authz: {
      dispatcher: options.authzDispatcher,
      newBindingId: () => authzBindingIds.newBindingId(),
      cacheEnabled: () => options.config.authz.epochCacheEnabled,
      demoProjectId: () => options.config.authz.demoProjectId,
    },
    apiKeys,
    dataRetention: options.dataRetention,
    share,
    topics,
    project,
  };
}
