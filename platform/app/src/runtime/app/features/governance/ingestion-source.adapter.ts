// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type {
  GovernanceIngestionSourceService,
} from "@langwatch/enterprise-governance-contract";
import type { ProjectService } from "@langwatch/project-contract";
import {
  GovernanceDiagnosticsPort,
  IngestionCredentialsService,
  IngestionSecretConfiguration,
  IngestionSecretService,
  IngestionSourceEntitlementsPort,
  IngestionSourceLifecyclePort,
  type IngestionPullLifecycleService,
  PostgresIngestionSourceAdapter,
  PullDestinationService,
} from "@langwatch/enterprise-governance-server";
import { createLogger } from "@langwatch/observability";
import type { PlanProvider } from "~/server/app-layer/subscription/plan-provider";
import { AppGovernanceEncryptionPort } from "./governance-infrastructure.adapter";

const logger = createLogger("langwatch:governance:ingestion-source");

class AppIngestionSourceEntitlementsPort extends IngestionSourceEntitlementsPort {
  private constructor(private readonly plans: PlanProvider) {
    super();
  }

  static create(plans: PlanProvider): AppIngestionSourceEntitlementsPort {
    return new AppIngestionSourceEntitlementsPort(plans);
  }

  async hasEnterprisePlan(organizationId: string): Promise<boolean> {
    return (
      await this.plans.getActivePlan({ organizationId })
    ).type === "ENTERPRISE";
  }
}

class AppIngestionSourceLifecyclePort extends IngestionSourceLifecyclePort {
  private constructor(
    private readonly lifecycle: Pick<IngestionPullLifecycleService, "sync">,
  ) {
    super();
  }

  static create(
    lifecycle: Pick<IngestionPullLifecycleService, "sync">,
  ): AppIngestionSourceLifecyclePort {
    return new AppIngestionSourceLifecyclePort(lifecycle);
  }

  sync(
    source: Parameters<IngestionSourceLifecyclePort["sync"]>[0],
  ): Promise<void> {
    return this.lifecycle.sync(source);
  }
}

class AppIngestionSourceDiagnosticsPort extends GovernanceDiagnosticsPort {
  warn(message: string, context: Record<string, unknown>): void {
    logger.warn(context, message);
  }
}

/** Composes the one ingestion-source service owned by the process App. */
export class AppIngestionSourceAdapter {
  private constructor(
    private readonly options: {
      database: object;
      projects: ProjectService;
      plans: PlanProvider;
      lifecycle: Pick<IngestionPullLifecycleService, "sync">;
      secretPepper: string;
    },
  ) {}

  static create(options: {
    database: object;
    projects: ProjectService;
    plans: PlanProvider;
    lifecycle: Pick<IngestionPullLifecycleService, "sync">;
    secretPepper: string;
  }): AppIngestionSourceAdapter {
    return new AppIngestionSourceAdapter(options);
  }

  build(): GovernanceIngestionSourceService {
    return PostgresIngestionSourceAdapter.create({
      database: this.options.database,
      projects: this.options.projects,
      entitlements: AppIngestionSourceEntitlementsPort.create(
        this.options.plans,
      ),
      lifecycle: AppIngestionSourceLifecyclePort.create(this.options.lifecycle),
      credentials: IngestionCredentialsService.create(
        new AppGovernanceEncryptionPort(),
      ),
      secrets: IngestionSecretService.create(
        IngestionSecretConfiguration.create({
          pepper: this.options.secretPepper,
        }),
      ),
      destinations: PullDestinationService.create(),
      diagnostics: new AppIngestionSourceDiagnosticsPort(),
    }).build();
  }
}
