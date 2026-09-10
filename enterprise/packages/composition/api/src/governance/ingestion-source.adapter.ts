// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  GovernanceDiagnostics,
  IngestionSourceEntitlementsPort,
  IngestionSourceLifecycle,
} from "@langwatch/enterprise-governance-server";
import { createLogger } from "@langwatch/observability";
import {
  AppGovernanceEncryption,
  type GovernanceEncryption,
} from "./governance-infrastructure.adapter.ts";

type PlanProvider = {
  getActivePlan(input: { organizationId: string }): Promise<{ type: string }>;
};

const logger = createLogger("langwatch:governance:ingestion-source");

class AppIngestionSourceEntitlements extends IngestionSourceEntitlementsPort {
  private constructor(private readonly plans: PlanProvider) {
    super();
  }

  static create(plans: PlanProvider): AppIngestionSourceEntitlements {
    return new AppIngestionSourceEntitlements(plans);
  }

  async hasEnterprisePlan(organizationId: string): Promise<boolean> {
    return (await this.plans.getActivePlan({ organizationId })).type === "ENTERPRISE";
  }
}

class AppIngestionSourceDiagnostics extends GovernanceDiagnostics {
  warn(message: string, context: Record<string, unknown>): void {
    logger.warn(context, message);
  }
}

class DisabledIngestionSourceLifecycle extends IngestionSourceLifecycle {
  async sync(): Promise<void> {}
}

/** Binds app dependencies to the server's ingestion-source installation seam. */
export class AppIngestionSourceAdapter {
  private constructor(
    private readonly options: {
      plans: PlanProvider;
      lifecycle: IngestionSourceLifecycle;
      secretPepper: string;
      encryption: GovernanceEncryption;
    },
  ) {}

  static create(options: {
    plans: PlanProvider;
    lifecycle: IngestionSourceLifecycle;
    secretPepper: string;
    encryption: GovernanceEncryption;
  }): AppIngestionSourceAdapter {
    return new AppIngestionSourceAdapter(options);
  }

  static disabledLifecycle(): IngestionSourceLifecycle {
    return new DisabledIngestionSourceLifecycle();
  }

  entitlements(): IngestionSourceEntitlementsPort {
    return AppIngestionSourceEntitlements.create(this.options.plans);
  }

  lifecycle(): IngestionSourceLifecycle {
    return this.options.lifecycle;
  }

  encryption(): AppGovernanceEncryption {
    return AppGovernanceEncryption.create(this.options.encryption);
  }

  secretPepper(): string {
    return this.options.secretPepper;
  }

  diagnostics(): GovernanceDiagnostics {
    return new AppIngestionSourceDiagnostics();
  }
}
