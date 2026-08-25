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
  type GovernanceTraceEvent,
  type GovernanceTraceSummary,
} from "@langwatch/enterprise-governance-server";
import { createLogger } from "@langwatch/observability";
import type { AutomationService } from "@langwatch/automation-contract";
import { NOTIFY_TRIGGER_ACTIONS } from "~/server/app-layer/automations/dispatch/triggerActionDispatch";
import type { RecordTriggerMatchPort } from "~/server/event-sourcing/pipelines/automations/subscribers/evaluationAlertTriggerMatch.subscriber";
import { passesTraceOriginGuards } from "~/server/event-sourcing/pipelines/trace-processing/subscribers/_originGuardedSubscriber";
import { classifyTriggerFilters } from "~/server/filters/triggerFilter.matcher";
import { incrementAutomationMatchRecordsTotal } from "~/server/metrics";
import { captureException, toError } from "~/utils/posthogErrorCapture";

type GovernanceKpiWriter = {
  insertContribution(row: GovernanceKpiContribution): Promise<void>;
};

type GovernanceOcsfWriter = {
  insertEvent(row: GovernanceOcsfEvent): Promise<void>;
};

class AppGovernanceSubscriberDiagnostics extends GovernanceSubscriberDiagnosticsPort {
  private readonly logger = createLogger(
    "langwatch:trace-processing:governance-subscribers",
  );

  warn(input: { code: string; tenantId: string; traceId: string }): void {
    this.logger.warn(input, input.code);
  }

  capture(error: unknown): void {
    this.logger.error({ error }, "governance subscriber projection failed");
    captureException(toError(error));
  }
}

class AppGovernanceKpiContributionPort extends GovernanceKpiContributionPort {
  private constructor(private readonly writer: GovernanceKpiWriter) {
    super();
  }

  static create(writer: GovernanceKpiWriter): AppGovernanceKpiContributionPort {
    return new AppGovernanceKpiContributionPort(writer);
  }

  insertContribution(row: GovernanceKpiContribution): Promise<void> {
    return this.writer.insertContribution(row);
  }
}

class AppGovernanceOcsfEventPort extends GovernanceOcsfEventPort {
  private constructor(private readonly writer: GovernanceOcsfWriter) {
    super();
  }

  static create(writer: GovernanceOcsfWriter): AppGovernanceOcsfEventPort {
    return new AppGovernanceOcsfEventPort(writer);
  }

  insertEvent(row: GovernanceOcsfEvent): Promise<void> {
    return this.writer.insertEvent(row);
  }
}

class AppTraceAlertTriggerPort extends TraceAlertTriggerPort {
  private constructor(private readonly triggers: AutomationService) {
    super();
  }

  static create(triggers: AutomationService): AppTraceAlertTriggerPort {
    return new AppTraceAlertTriggerPort(triggers);
  }

  async activeForProject(projectId: string) {
    const triggers =
      await this.triggers.getActiveTraceTriggersForProject(projectId);
    return triggers.map((trigger) => ({
      id: trigger.id,
      action: trigger.action,
      actionClass: NOTIFY_TRIGGER_ACTIONS.has(trigger.action)
        ? ("notify" as const)
        : ("persist" as const),
      traceDebounceMs: trigger.traceDebounceMs,
      notificationCadence: trigger.notificationCadence,
      hasEvaluationFilters: classifyTriggerFilters(trigger.filters)
        .hasEvaluationFilters,
    }));
  }
}

class AppTraceAlertTriggerMatchPort extends TraceAlertTriggerMatchPort {
  private constructor(private readonly matches: RecordTriggerMatchPort) {
    super();
  }

  static create(matches: RecordTriggerMatchPort): AppTraceAlertTriggerMatchPort {
    return new AppTraceAlertTriggerMatchPort(matches);
  }

  async send(
    input: Parameters<TraceAlertTriggerMatchPort["send"]>[0],
  ): Promise<void> {
    await this.matches.send(input);
  }
}

class AppTraceAlertOriginGuardPort extends TraceAlertOriginGuardPort {
  passes(input: {
    event: GovernanceTraceEvent;
    state: GovernanceTraceSummary;
  }): boolean {
    return passesTraceOriginGuards(input.event, input.state);
  }
}

class AppTraceAlertMetricsPort extends TraceAlertMetricsPort {
  countRecorded(count: number): void {
    incrementAutomationMatchRecordsTotal(count);
  }
}

export class AppGovernanceSubscriberAdapter {
  private constructor(
    private readonly diagnostics: GovernanceSubscriberDiagnosticsPort,
  ) {}

  static create(): AppGovernanceSubscriberAdapter {
    return new AppGovernanceSubscriberAdapter(
      new AppGovernanceSubscriberDiagnostics(),
    );
  }

  kpis(writer: GovernanceKpiWriter): GovernanceKpisSubscriber {
    return GovernanceKpisSubscriber.create({
      contributions: AppGovernanceKpiContributionPort.create(writer),
      diagnostics: this.diagnostics,
    });
  }

  ocsf(writer: GovernanceOcsfWriter): GovernanceOcsfSubscriber {
    return GovernanceOcsfSubscriber.create({
      events: AppGovernanceOcsfEventPort.create(writer),
      diagnostics: this.diagnostics,
    });
  }

  traceAlerts(options: {
    triggers: AutomationService;
    matches: RecordTriggerMatchPort;
  }): TraceAlertTriggerMatchSubscriber {
    return TraceAlertTriggerMatchSubscriber.create({
      triggers: AppTraceAlertTriggerPort.create(options.triggers),
      matches: AppTraceAlertTriggerMatchPort.create(options.matches),
      originGuard: new AppTraceAlertOriginGuardPort(),
      metrics: new AppTraceAlertMetricsPort(),
    });
  }
}

export type AppGovernanceKpisSubscriberDependencies = {
  governanceKpisRepository: GovernanceKpiWriter;
};

export type AppGovernanceOcsfSubscriberDependencies = {
  governanceOcsfEventsRepository: GovernanceOcsfWriter;
};
