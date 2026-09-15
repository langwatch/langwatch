// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  createGovernanceSignals,
  type GovernanceDiagnosticsSink,
  type GovernanceSignalChannel,
  type GovernanceSignalService,
  type GatewayBudgetCrossingCandidate,
  type GovernanceBudgetCrossingData,
  type GovernanceResolvedBudgetCrossing,
  type GovernanceVirtualKeyLifecycleSignal,
  type GovernanceVkLifecycleData,
} from "@langwatch/enterprise-governance-server";
import { createLogger } from "@langwatch/observability";
import { type Instant, nowInstant } from "@langwatch/time";

const logger = createLogger("langwatch:governance:signals");

/** Complete storage capability supplied by API composition. */
export abstract class GovernanceSignalStorage {
  abstract tryResolveLifecycleTenant(input: {
    organizationId: string;
    preferredProjectId: string | null;
  }): Promise<string | null>;
  abstract resolveBudgetCrossings(
    candidates: GatewayBudgetCrossingCandidate[],
    now: Instant,
  ): Promise<GovernanceResolvedBudgetCrossing[]>;
}

/** Complete delivery capability owned by the Governance events pipeline. */
export abstract class GovernanceSignalDelivery {
  abstract available(): boolean;
  abstract appendVirtualKeyLifecycle(data: GovernanceVkLifecycleData): Promise<void>;
  abstract appendBudgetCrossing(data: GovernanceBudgetCrossingData): Promise<void>;
}

class AppGovernanceSignalDiagnostics implements GovernanceDiagnosticsSink {
  warn(message: string, context: Record<string, unknown>): void {
    logger.warn(context, message);
  }
}

class DisabledGovernanceSignalStorage extends GovernanceSignalStorage {
  async tryResolveLifecycleTenant(): Promise<string | null> {
    return null;
  }

  async resolveBudgetCrossings(): Promise<GovernanceResolvedBudgetCrossing[]> {
    return [];
  }
}

class DisabledGovernanceSignalDelivery extends GovernanceSignalDelivery {
  available(): boolean {
    return false;
  }

  async appendVirtualKeyLifecycle(): Promise<void> {}

  async appendBudgetCrossing(): Promise<void> {}
}

class AppGovernanceSignal implements GovernanceSignalChannel {
  private constructor(
    private readonly storage: GovernanceSignalStorage,
    private readonly delivery: GovernanceSignalDelivery,
  ) {}

  static create(
    storage: GovernanceSignalStorage,
    delivery: GovernanceSignalDelivery,
  ): AppGovernanceSignal {
    return new AppGovernanceSignal(storage, delivery);
  }

  available(): boolean {
    return this.delivery.available();
  }

  now(): Instant {
    return nowInstant();
  }

  async tryResolveLifecycleTenant(input: {
    organizationId: string;
    preferredProjectId: string | null;
  }): Promise<string | null> {
    return this.storage.tryResolveLifecycleTenant(input);
  }

  async resolveBudgetCrossings(
    candidates: GatewayBudgetCrossingCandidate[],
    now: Instant,
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
    private readonly port: AppGovernanceSignal,
    private readonly service: GovernanceSignalService,
  ) {}

  static create(
    storage: GovernanceSignalStorage,
    delivery: GovernanceSignalDelivery,
  ): AppGovernanceSignalsService {
    const port = AppGovernanceSignal.create(storage, delivery);
    return new AppGovernanceSignalsService(
      port,
      createGovernanceSignals(port, new AppGovernanceSignalDiagnostics()),
    );
  }

  static disabled(): AppGovernanceSignalsService {
    return AppGovernanceSignalsService.create(
      new DisabledGovernanceSignalStorage(),
      new DisabledGovernanceSignalDelivery(),
    );
  }

  emitVirtualKeyLifecycle(signal: GovernanceVirtualKeyLifecycleSignal): Promise<void> {
    return this.service.emitVirtualKeyLifecycle(signal);
  }

  detectBudgetCrossings(candidates: GatewayBudgetCrossingCandidate[]): Promise<void> {
    return this.service.detectBudgetCrossings(candidates);
  }
}
