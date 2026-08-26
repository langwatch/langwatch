import type {
  GovernanceHttpResponse,
  PulledUsageRateInput,
} from "@langwatch/enterprise-governance-server";
import {
  GovernanceIngestionPullHost,
  type GovernanceHttpRequest,
} from "@langwatch/enterprise-api/governance/ingestion-pull-worker.adapter";
import type {
  GovernanceIngestionPullMetricsPort,
  GovernanceIngestionPullSchedulePort,
} from "@langwatch/enterprise-api/governance/governance-eventing.adapter";
import type { GovernanceEncryption } from "@langwatch/enterprise-api/governance/governance-infrastructure.adapter";
import type {
  GovernanceModelProviderCatalogPort,
  GovernanceOrganizationContactPort,
} from "@langwatch/enterprise-api/governance/governance-products.adapter";
import type { PrismaClient } from "~/generated/prisma/client";
import type { FeatureFlagServiceInterface } from "~/server/featureFlag";
import { computeNextRunAt } from "~/server/app-layer/scheduler/nextRunAt";
import { EMPTY_SPEND_USAGE } from "~/server/event-sourcing/pipelines/gateway-spend-processing/schemas/commands";
import { rateSpendNanoUsd } from "~/server/event-sourcing/pipelines/gateway-spend-processing/services/spend-rating.service";
import {
  incrementIngestionPullTotal,
  observeIngestionPullDuration,
} from "~/server/metrics";
import { modelProviders } from "~/server/modelProviders/registry";
import { resolveOrgAdminEmail } from "~/server/organizations/resolveOrgAdminEmail";
import { decrypt, encrypt } from "~/utils/encryption";
import { captureException, toError, withScope } from "~/utils/posthogErrorCapture";
import { ssrfSafeFetch } from "~/utils/ssrfProtection";

class AppGovernanceEncryption implements GovernanceEncryption {
  encrypt(value: string): string {
    return encrypt(value);
  }

  decrypt(value: string): string {
    return decrypt(value);
  }
}

/** API-process infrastructure for the canonical ingestion-pull worker. */
export class AppGovernanceIngestionPullHost extends GovernanceIngestionPullHost {
  private constructor(private readonly featureFlags: FeatureFlagServiceInterface) {
    super();
  }

  static create(
    featureFlags: FeatureFlagServiceInterface,
  ): AppGovernanceIngestionPullHost {
    return new AppGovernanceIngestionPullHost(featureFlags);
  }

  readonly encryption = new AppGovernanceEncryption();

  fetch(url: string, init: GovernanceHttpRequest): Promise<GovernanceHttpResponse> {
    return ssrfSafeFetch(url, init);
  }

  ratePulledUsage(input: PulledUsageRateInput): {
    costNanoUsd: number;
    rateVersion: string;
  } {
    return rateSpendNanoUsd({
      model: input.model,
      usage: {
        ...EMPTY_SPEND_USAGE,
        input_tokens: input.quantities.tokensInput,
        output_tokens: input.quantities.tokensOutput,
        cache_read_input_tokens: input.quantities.tokensCacheRead,
        cache_creation_input_tokens: input.quantities.tokensCacheWrite,
      },
    });
  }

  isPulledUsageCostEnabled(organizationId: string): Promise<boolean> {
    return this.featureFlags.isEnabled("release_pulled_usage_cost_enabled", {
      distinctId: organizationId,
      organizationId,
    });
  }

  capture(error: Error, context: Record<string, unknown>): void {
    void withScope(async (scope) => {
      for (const [key, value] of Object.entries(context)) {
        scope.setExtra?.(key, value);
      }
      captureException(toError(error));
    });
  }
}

export class AppGovernanceIngestionPullMetrics implements GovernanceIngestionPullMetricsPort {
  private constructor() {}

  static create(): AppGovernanceIngestionPullMetrics {
    return new AppGovernanceIngestionPullMetrics();
  }

  count(outcome: "completed" | "failed_retryable" | "failed_final"): void {
    incrementIngestionPullTotal({ outcome });
  }

  observeDuration(durationMs: number): void {
    observeIngestionPullDuration(durationMs);
  }
}

export class AppGovernanceIngestionPullSchedule implements GovernanceIngestionPullSchedulePort {
  private constructor() {}

  static create(): AppGovernanceIngestionPullSchedule {
    return new AppGovernanceIngestionPullSchedule();
  }

  nextRunAt(input: { cron: string; after: number }): number {
    return computeNextRunAt({
      cron: input.cron,
      timezone: "UTC",
      after: new Date(input.after),
    }).getTime();
  }
}

export class AppGovernanceModelProviderCatalog implements GovernanceModelProviderCatalogPort {
  private constructor() {}

  static create(): AppGovernanceModelProviderCatalog {
    return new AppGovernanceModelProviderCatalog();
  }

  list(): Array<{ providerKey: string; displayName: string; type: string }> {
    return Object.entries(modelProviders).map(([providerKey, provider]) => ({
      providerKey,
      displayName: provider.name,
      type: provider.type,
    }));
  }
}

export class AppGovernanceOrganizationContacts implements GovernanceOrganizationContactPort {
  private constructor(private readonly database: PrismaClient) {}

  static create(database: PrismaClient): AppGovernanceOrganizationContacts {
    return new AppGovernanceOrganizationContacts(database);
  }

  tryResolveAdminEmail(organizationId: string): Promise<string | null> {
    return resolveOrgAdminEmail({ prisma: this.database, organizationId });
  }
}
