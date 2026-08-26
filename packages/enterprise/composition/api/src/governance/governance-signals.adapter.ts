// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  GovernanceDiagnosticsPort,
  GovernanceSignalPort,
  GovernanceSignalService,
  type GatewayBudgetCrossingCandidate,
  type GovernanceBudgetCrossingData,
  type GovernanceResolvedBudgetCrossing,
  type GovernanceVirtualKeyLifecycleSignal,
  type GovernanceVkLifecycleData,
} from "@langwatch/enterprise-governance-server";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:governance:signals");

/** Complete storage capability supplied by API composition. */
export abstract class GovernanceSignalStoragePort {
  abstract tryResolveLifecycleTenant(input: {
    organizationId: string;
    preferredProjectId: string | null;
  }): Promise<string | null>;
  abstract resolveBudgetCrossings(
    candidates: GatewayBudgetCrossingCandidate[],
    now: Date,
  ): Promise<GovernanceResolvedBudgetCrossing[]>;
}

/** Complete delivery capability owned by the Governance events pipeline. */
export abstract class GovernanceSignalDeliveryPort {
  abstract available(): boolean;
  abstract appendVirtualKeyLifecycle(data: GovernanceVkLifecycleData): Promise<void>;
  abstract appendBudgetCrossing(data: GovernanceBudgetCrossingData): Promise<void>;
}

class AppGovernanceSignalDiagnostics extends GovernanceDiagnosticsPort {
  warn(message: string, context: Record<string, unknown>): void {
    logger.warn(context, message);
  }
}

class DisabledGovernanceSignalStoragePort extends GovernanceSignalStoragePort {
  async tryResolveLifecycleTenant(): Promise<string | null> {
    return null;
  }

  async resolveBudgetCrossings(): Promise<GovernanceResolvedBudgetCrossing[]> {
    return [];
  }
}

class DisabledGovernanceSignalDeliveryPort extends GovernanceSignalDeliveryPort {
  available(): boolean {
    return false;
  }

  async appendVirtualKeyLifecycle(): Promise<void> {}

  async appendBudgetCrossing(): Promise<void> {}
}

class AppGovernanceSignalPort extends GovernanceSignalPort {
  private constructor(
    private readonly storage: GovernanceSignalStoragePort,
    private readonly delivery: GovernanceSignalDeliveryPort,
  ) {
    super();
  }

  static create(
    storage: GovernanceSignalStoragePort,
    delivery: GovernanceSignalDeliveryPort,
  ): AppGovernanceSignalPort {
    return new AppGovernanceSignalPort(storage, delivery);
  }

  available(): boolean {
    return this.delivery.available();
  }

  now(): Date {
    return new Date();
  }

  async tryResolveLifecycleTenant(input: {
    organizationId: string;
    preferredProjectId: string | null;
  }): Promise<string | null> {
    return this.storage.tryResolveLifecycleTenant(input);
  }

  async resolveBudgetCrossings(
    candidates: GatewayBudgetCrossingCandidate[],
    now: Date,
  ): Promise<GovernanceResolvedBudgetCrossing[]> {
    return this.storage.resolveBudgetCrossings(candidates, now);
  }

  async appendVirtualKeyLifecycle(data: GovernanceVkLifecycleData): Promise<void> {
    await this.delivery.appendVirtualKeyLifecycle(data);
  }

  async appendBudgetCrossing(data: GovernanceBudgetCrossingData): Promise<void> {
    await this.delivery.appendBudgetCrossing(data);
  }
}

export class AppGovernanceSignalsService {
  private constructor(
    private readonly port: AppGovernanceSignalPort,
    private readonly service: GovernanceSignalService,
  ) {}

  static create(
    storage: GovernanceSignalStoragePort,
    delivery: GovernanceSignalDeliveryPort,
  ): AppGovernanceSignalsService {
    const port = AppGovernanceSignalPort.create(storage, delivery);
    return new AppGovernanceSignalsService(
      port,
      GovernanceSignalService.create(port, new AppGovernanceSignalDiagnostics()),
    );
  }

  static disabled(): AppGovernanceSignalsService {
    return AppGovernanceSignalsService.create(
      new DisabledGovernanceSignalStoragePort(),
      new DisabledGovernanceSignalDeliveryPort(),
    );
  }

  emitVirtualKeyLifecycle(signal: GovernanceVirtualKeyLifecycleSignal): Promise<void> {
    return this.service.emitVirtualKeyLifecycle(signal);
  }

  detectBudgetCrossings(candidates: GatewayBudgetCrossingCandidate[]): Promise<void> {
    return this.service.detectBudgetCrossings(candidates);
  }
}
