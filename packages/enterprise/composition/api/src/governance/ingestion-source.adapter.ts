// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  GovernanceDiagnosticsPort,
  IngestionSourceEntitlementsPort,
  IngestionSourceLifecyclePort,
} from "@langwatch/enterprise-governance-server";
import { createLogger } from "@langwatch/observability";
import {
  AppGovernanceEncryptionPort,
  type GovernanceEncryption,
} from "./governance-infrastructure.adapter";

type PlanProvider = {
  getActivePlan(input: { organizationId: string }): Promise<{ type: string }>;
};

const logger = createLogger("langwatch:governance:ingestion-source");

class AppIngestionSourceEntitlementsPort extends IngestionSourceEntitlementsPort {
  private constructor(private readonly plans: PlanProvider) {
    super();
  }

  static create(plans: PlanProvider): AppIngestionSourceEntitlementsPort {
    return new AppIngestionSourceEntitlementsPort(plans);
  }

  async hasEnterprisePlan(organizationId: string): Promise<boolean> {
    return (await this.plans.getActivePlan({ organizationId })).type === "ENTERPRISE";
  }
}

class AppIngestionSourceDiagnosticsPort extends GovernanceDiagnosticsPort {
  warn(message: string, context: Record<string, unknown>): void {
    logger.warn(context, message);
  }
}

class DisabledIngestionSourceLifecyclePort extends IngestionSourceLifecyclePort {
  async sync(): Promise<void> {}
}

/** Binds app dependencies to the server's ingestion-source installation seam. */
export class AppIngestionSourceAdapter {
  private constructor(
    private readonly options: {
      plans: PlanProvider;
      lifecycle: IngestionSourceLifecyclePort;
      secretPepper: string;
      encryption: GovernanceEncryption;
    },
  ) {}

  static create(options: {
    plans: PlanProvider;
    lifecycle: IngestionSourceLifecyclePort;
    secretPepper: string;
    encryption: GovernanceEncryption;
  }): AppIngestionSourceAdapter {
    return new AppIngestionSourceAdapter(options);
  }

  static disabledLifecycle(): IngestionSourceLifecyclePort {
    return new DisabledIngestionSourceLifecyclePort();
  }

  entitlements(): IngestionSourceEntitlementsPort {
    return AppIngestionSourceEntitlementsPort.create(this.options.plans);
  }

  lifecycle(): IngestionSourceLifecyclePort {
    return this.options.lifecycle;
  }

  encryption(): AppGovernanceEncryptionPort {
    return AppGovernanceEncryptionPort.create(this.options.encryption);
  }

  secretPepper(): string {
    return this.options.secretPepper;
  }

  diagnostics(): GovernanceDiagnosticsPort {
    return new AppIngestionSourceDiagnosticsPort();
  }
}
