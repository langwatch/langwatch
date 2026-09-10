// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  GovernanceKpiContributionPort,
  GovernanceKpisSubscriber,
  GovernanceOcsfEventPort,
  GovernanceOcsfSubscriber,
  GovernanceSubscriberDiagnostics,
  TraceAlertMetrics,
  TraceAlertOriginGuardPort,
  TraceAlertTriggerMatch,
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

class AppGovernanceSubscriberDiagnostics extends GovernanceSubscriberDiagnostics {
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

class AppGovernanceKpiContribution extends GovernanceKpiContributionPort {
  private constructor(private readonly writer: GovernanceKpiContributionPort) {
    super();
  }

  static create(writer: GovernanceKpiContributionPort): AppGovernanceKpiContribution {
    return new AppGovernanceKpiContribution(writer);
  }

  insertContribution(row: GovernanceKpiContribution): Promise<void> {
    return this.writer.insertContribution(row);
  }
}

class AppGovernanceOcsfEvent extends GovernanceOcsfEventPort {
  private constructor(private readonly writer: GovernanceOcsfEventPort) {
    super();
  }

  static create(writer: GovernanceOcsfEventPort): AppGovernanceOcsfEvent {
    return new AppGovernanceOcsfEvent(writer);
  }

  insertEvent(row: GovernanceOcsfEvent): Promise<void> {
    return this.writer.insertEvent(row);
  }
}

class AppTraceAlertTrigger extends TraceAlertTriggerPort {
  private constructor(private readonly triggers: TraceAlertTriggerPort) {
    super();
  }

  static create(triggers: TraceAlertTriggerPort): AppTraceAlertTrigger {
    return new AppTraceAlertTrigger(triggers);
  }

  activeForProject(projectId: string) {
    return this.triggers.activeForProject(projectId);
  }
}

class AppTraceAlertTriggerMatch extends TraceAlertTriggerMatch {
  private constructor(private readonly matches: TraceAlertTriggerMatch) {
    super();
  }

  static create(matches: TraceAlertTriggerMatch): AppTraceAlertTriggerMatch {
    return new AppTraceAlertTriggerMatch(matches);
  }

  async send(input: TraceAlertTriggerMatchInput): Promise<void> {
    await this.matches.send(input);
  }
}

class AppTraceAlertOriginGuard extends TraceAlertOriginGuardPort {
  constructor(private readonly runtime: GovernanceSubscriberRuntime) {
    super();
  }

  passes(input: { event: GovernanceTraceEvent; state: GovernanceTraceSummary }): boolean {
    return this.runtime.passesTraceOriginGuard(input);
  }
}

class AppTraceAlertMetrics extends TraceAlertMetrics {
  constructor(private readonly runtime: GovernanceSubscriberRuntime) {
    super();
  }

  countRecorded(count: number): void {
    this.runtime.countAutomationMatchRecords(count);
  }
}

export class AppGovernanceSubscriberAdapter {
  private constructor(
    private readonly diagnostics: GovernanceSubscriberDiagnostics,
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
      contributions: AppGovernanceKpiContribution.create(writer),
      diagnostics: this.diagnostics,
    });
  }

  ocsf(writer: GovernanceOcsfEventPort): GovernanceOcsfSubscriber {
    return GovernanceOcsfSubscriber.create({
      events: AppGovernanceOcsfEvent.create(writer),
      diagnostics: this.diagnostics,
    });
  }

  traceAlerts(
    triggers: TraceAlertTriggerPort,
    matches: TraceAlertTriggerMatch,
  ): (event: GovernanceTraceEvent, context: GovernanceTraceContext) => Promise<void> {
    const subscriber = TraceAlertTriggerMatchSubscriber.create({
      triggers: AppTraceAlertTrigger.create(triggers),
      matches: AppTraceAlertTriggerMatch.create(matches),
      originGuard: new AppTraceAlertOriginGuard(this.runtime),
      metrics: new AppTraceAlertMetrics(this.runtime),
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
