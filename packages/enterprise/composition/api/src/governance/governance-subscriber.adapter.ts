// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  GovernanceKpiContributionPort,
  GovernanceKpisSubscriber,
  GovernanceOcsfEventPort,
  GovernanceOcsfSubscriber,
  GovernanceSubscriberDiagnosticsPort,
  TraceAlertMetricsPort,
  TraceAlertOriginGuardPort,
  TraceAlertTriggerMatchPort,
  TraceAlertTriggerMatchSubscriber,
  TraceAlertTriggerPort,
  type GovernanceKpiContribution,
  type GovernanceOcsfEvent,
  type GovernanceTraceContext,
  type GovernanceTraceEvent,
  type GovernanceTraceSummary,
} from "@langwatch/enterprise-governance-server";
import { createLogger } from "@langwatch/observability";

export type TraceAlertTriggerMatchInput = {
  tenantId: string;
  occurredAt: number;
  triggerId: string;
  traceId: string;
  action: string;
  actionClass: "notify" | "persist";
  traceDebounceMs: number;
  notificationCadence: string | null;
};

/** Complete process runtime for Governance trace subscribers. */
export abstract class GovernanceSubscriberRuntime {
  abstract capture(error: unknown): void;
  abstract passesTraceOriginGuard(input: {
    event: GovernanceTraceEvent;
    state: GovernanceTraceSummary;
  }): boolean;
  abstract countAutomationMatchRecords(count: number): void;
}

class AppGovernanceSubscriberDiagnostics extends GovernanceSubscriberDiagnosticsPort {
  private readonly logger = createLogger("langwatch:trace-processing:governance-subscribers");

  warn(input: { code: string; tenantId: string; traceId: string }): void {
    this.logger.warn(input, input.code);
  }

  constructor(private readonly runtime: GovernanceSubscriberRuntime) {
    super();
  }

  capture(error: unknown): void {
    this.logger.error({ error }, "governance subscriber projection failed");
    this.runtime.capture(error);
  }
}

class AppGovernanceKpiContributionPort extends GovernanceKpiContributionPort {
  private constructor(private readonly writer: GovernanceKpiContributionPort) {
    super();
  }

  static create(writer: GovernanceKpiContributionPort): AppGovernanceKpiContributionPort {
    return new AppGovernanceKpiContributionPort(writer);
  }

  insertContribution(row: GovernanceKpiContribution): Promise<void> {
    return this.writer.insertContribution(row);
  }
}

class AppGovernanceOcsfEventPort extends GovernanceOcsfEventPort {
  private constructor(private readonly writer: GovernanceOcsfEventPort) {
    super();
  }

  static create(writer: GovernanceOcsfEventPort): AppGovernanceOcsfEventPort {
    return new AppGovernanceOcsfEventPort(writer);
  }

  insertEvent(row: GovernanceOcsfEvent): Promise<void> {
    return this.writer.insertEvent(row);
  }
}

class AppTraceAlertTriggerPort extends TraceAlertTriggerPort {
  private constructor(private readonly triggers: TraceAlertTriggerPort) {
    super();
  }

  static create(triggers: TraceAlertTriggerPort): AppTraceAlertTriggerPort {
    return new AppTraceAlertTriggerPort(triggers);
  }

  activeForProject(projectId: string) {
    return this.triggers.activeForProject(projectId);
  }
}

class AppTraceAlertTriggerMatchPort extends TraceAlertTriggerMatchPort {
  private constructor(private readonly matches: TraceAlertTriggerMatchPort) {
    super();
  }

  static create(matches: TraceAlertTriggerMatchPort): AppTraceAlertTriggerMatchPort {
    return new AppTraceAlertTriggerMatchPort(matches);
  }

  async send(input: TraceAlertTriggerMatchInput): Promise<void> {
    await this.matches.send(input);
  }
}

class AppTraceAlertOriginGuardPort extends TraceAlertOriginGuardPort {
  constructor(private readonly runtime: GovernanceSubscriberRuntime) {
    super();
  }

  passes(input: { event: GovernanceTraceEvent; state: GovernanceTraceSummary }): boolean {
    return this.runtime.passesTraceOriginGuard(input);
  }
}

class AppTraceAlertMetricsPort extends TraceAlertMetricsPort {
  constructor(private readonly runtime: GovernanceSubscriberRuntime) {
    super();
  }

  countRecorded(count: number): void {
    this.runtime.countAutomationMatchRecords(count);
  }
}

export class AppGovernanceSubscriberAdapter {
  private constructor(
    private readonly diagnostics: GovernanceSubscriberDiagnosticsPort,
    private readonly runtime: GovernanceSubscriberRuntime,
  ) {}

  static create(runtime: GovernanceSubscriberRuntime): AppGovernanceSubscriberAdapter {
    return new AppGovernanceSubscriberAdapter(
      new AppGovernanceSubscriberDiagnostics(runtime),
      runtime,
    );
  }

  kpis(writer: GovernanceKpiContributionPort): GovernanceKpisSubscriber {
    return GovernanceKpisSubscriber.create({
      contributions: AppGovernanceKpiContributionPort.create(writer),
      diagnostics: this.diagnostics,
    });
  }

  ocsf(writer: GovernanceOcsfEventPort): GovernanceOcsfSubscriber {
    return GovernanceOcsfSubscriber.create({
      events: AppGovernanceOcsfEventPort.create(writer),
      diagnostics: this.diagnostics,
    });
  }

  traceAlerts(
    triggers: TraceAlertTriggerPort,
    matches: TraceAlertTriggerMatchPort,
  ): (event: GovernanceTraceEvent, context: GovernanceTraceContext) => Promise<void> {
    const subscriber = TraceAlertTriggerMatchSubscriber.create({
      triggers: AppTraceAlertTriggerPort.create(triggers),
      matches: AppTraceAlertTriggerMatchPort.create(matches),
      originGuard: new AppTraceAlertOriginGuardPort(this.runtime),
      metrics: new AppTraceAlertMetricsPort(this.runtime),
    });

    return (event, context) => subscriber.handle(event, context);
  }
}

export type AppGovernanceKpisSubscriberDependencies = {
  governanceKpisRepository: GovernanceKpiContributionPort;
};

export type AppGovernanceOcsfSubscriberDependencies = {
  governanceOcsfEventsRepository: GovernanceOcsfEventPort;
};
