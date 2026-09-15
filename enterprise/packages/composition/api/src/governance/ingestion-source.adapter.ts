// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  type GovernanceDiagnosticsSink,
  type IngestionSourceEntitlements,
  type IngestionSourceLifecycleChannel,
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

class AppIngestionSourceEntitlements implements IngestionSourceEntitlements {
  private constructor(private readonly plans: PlanProvider) {}

  static create(plans: PlanProvider): AppIngestionSourceEntitlements {
    return new AppIngestionSourceEntitlements(plans);
  }

  async hasEnterprisePlan(organizationId: string): Promise<boolean> {
    return (await this.plans.getActivePlan({ organizationId })).type === "ENTERPRISE";
  }
}

class AppIngestionSourceDiagnostics implements GovernanceDiagnosticsSink {
  warn(message: string, context: Record<string, unknown>): void {
    logger.warn(context, message);
  }
}

class DisabledIngestionSourceLifecycle implements IngestionSourceLifecycleChannel {
  async sync(): Promise<void> {}
}

/** Binds app dependencies to the server's ingestion-source installation seam. */
export class AppIngestionSourceAdapter {
  private constructor(
    private readonly options: {
      plans: PlanProvider;
      lifecycle: IngestionSourceLifecycleChannel;
      secretPepper: string;
      encryption: GovernanceEncryption;
    },
  ) {}

  static create(options: {
    plans: PlanProvider;
    lifecycle: IngestionSourceLifecycleChannel;
    secretPepper: string;
    encryption: GovernanceEncryption;
  }): AppIngestionSourceAdapter {
    return new AppIngestionSourceAdapter(options);
  }

  static disabledLifecycle(): IngestionSourceLifecycleChannel {
    return new DisabledIngestionSourceLifecycle();
  }

  entitlements(): IngestionSourceEntitlements {
    return AppIngestionSourceEntitlements.create(this.options.plans);
  }

  lifecycle(): IngestionSourceLifecycleChannel {
    return this.options.lifecycle;
  }

  encryption(): AppGovernanceEncryption {
    return AppGovernanceEncryption.create(this.options.encryption);
  }

  secretPepper(): string {
    return this.options.secretPepper;
  }

  diagnostics(): GovernanceDiagnosticsSink {
    return new AppIngestionSourceDiagnostics();
  }
}
