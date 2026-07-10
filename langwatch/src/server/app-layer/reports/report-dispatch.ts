import type { Project, Trigger } from "@prisma/client";
import type { ScheduledJobFire } from "~/server/app-layer/scheduler/scheduler.types";
import { extractReportFromTriggerRow } from "~/server/app-layer/triggers/report.builder";
import type { ReportSource } from "~/server/app-layer/triggers/report.builder";
import type { sendRenderedTriggerEmail } from "~/server/mailer/triggerEmail";
import type { sendRenderedSlackMessage } from "~/server/triggers/sendSlackWebhook";
import { REPORT_TRIGGER_DEFAULTS } from "~/shared/templating/defaults";
import { renderTriggerEmail } from "~/shared/templating/renderEmail";
import {
  renderTriggerSlack,
  type SlackTemplateType,
} from "~/shared/templating/renderSlack";
import { buildReportTemplateContext } from "~/shared/templating/templateContext";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:report-dispatch");

export interface ReportDispatchDeps {
  loadTrigger(params: {
    projectId: string;
    triggerId: string;
  }): Promise<Trigger | null>;
  loadProject(projectId: string): Promise<Project | null>;
  sendEmail: typeof sendRenderedTriggerEmail;
  sendSlack: typeof sendRenderedSlackMessage;
  filterSuppressedRecipients: (params: {
    projectId: string;
    triggerId: string;
    emails: string[];
  }) => Promise<string[]>;
  baseHost: string;
}

/** Human summary of what a report renders (context `report.sourceLabel`). */
function sourceLabel(source: ReportSource): string {
  switch (source.kind) {
    case "traceQuery":
      return `Top ${source.topN} matching traces`;
    case "customGraph":
      return "Custom graph";
    case "dashboard":
      return "Dashboard";
  }
}

/** Deep link to view the report's underlying data. */
function viewUrl(source: ReportSource, baseHost: string, slug: string): string {
  const base = `${baseHost}/${slug}`;
  switch (source.kind) {
    case "traceQuery":
      return `${base}/messages`;
    case "customGraph":
      return `${base}/analytics/custom/${source.customGraphId}`;
    case "dashboard":
      return `${base}/analytics`;
  }
}

/** Light human schedule description (enrich with a cron humanizer later). */
function scheduleLabel(cron: string, timezone: string): string {
  return `on schedule \`${cron}\` (${timezone})`;
}

/**
 * ADR-042 Phase 3c: the scheduler's report handler. When a report's
 * `ScheduledJob` comes due, load the trigger, render its content, and dispatch
 * via the SAME notify pipeline alerts use (`renderTriggerEmail` /
 * `renderTriggerSlack` + the rendered-form senders), against
 * `REPORT_TRIGGER_DEFAULTS`. Data rows (a trace-query table, charts) are
 * enriched in later phases — this phase delivers the report summary + a deep
 * link on schedule. Registered on `schedulerRegistry` for the `reportTrigger`
 * target type.
 */
export async function dispatchScheduledReport({
  deps,
  fire,
}: {
  deps: ReportDispatchDeps;
  fire: ScheduledJobFire;
}): Promise<void> {
  const trigger = await deps.loadTrigger({
    projectId: fire.projectId,
    triggerId: fire.targetId,
  });
  if (!trigger || !trigger.active || trigger.deleted) {
    logger.info(
      { triggerId: fire.targetId, projectId: fire.projectId },
      "Report trigger missing/inactive — skipping scheduled fire",
    );
    return;
  }

  const report = extractReportFromTriggerRow(trigger.actionParams);
  if (!report) {
    logger.warn(
      { triggerId: trigger.id, projectId: fire.projectId },
      "Report trigger actionParams did not parse — skipping",
    );
    return;
  }

  const project = await deps.loadProject(fire.projectId);
  if (!project) return;

  const params = trigger.actionParams as {
    members?: string[];
    slackWebhook?: string;
  };
  const context = buildReportTemplateContext({
    trigger: { id: trigger.id, name: trigger.name },
    report: {
      sourceLabel: sourceLabel(report.source),
      scheduleLabel: scheduleLabel(
        report.schedule.cron,
        report.schedule.timezone,
      ),
    },
    viewUrl: viewUrl(report.source, deps.baseHost, project.slug),
    rows: [],
    occurredAt: fire.slot,
    project: { id: project.id, name: project.name, slug: project.slug },
    baseHost: deps.baseHost,
  });

  if (trigger.action === "SEND_EMAIL") {
    const recipients = params.members ?? [];
    if (recipients.length === 0) return;
    const allowed = await deps.filterSuppressedRecipients({
      projectId: project.id,
      triggerId: trigger.id,
      emails: recipients,
    });
    if (allowed.length === 0) return;
    const rendered = await renderTriggerEmail({
      subjectTemplate: trigger.emailSubjectTemplate,
      bodyTemplate: trigger.emailBodyTemplate,
      context,
      defaults: {
        emailSubject: REPORT_TRIGGER_DEFAULTS.emailSubject,
        emailBody: REPORT_TRIGGER_DEFAULTS.emailBody,
      },
    });
    await deps.sendEmail({
      triggerEmails: allowed,
      triggerId: trigger.id,
      projectId: project.id,
      subject: rendered.subject,
      html: rendered.html,
    });
    return;
  }

  if (trigger.action === "SEND_SLACK_MESSAGE") {
    const webhook = params.slackWebhook ?? null;
    if (!webhook) return;
    const templateType: SlackTemplateType | null =
      trigger.slackTemplateType === "block_kit" ? "block_kit" : "string";
    const rendered = await renderTriggerSlack({
      templateType,
      template: trigger.slackTemplate,
      context,
      defaults: {
        slackString: REPORT_TRIGGER_DEFAULTS.slackString,
        slackBlockKit: REPORT_TRIGGER_DEFAULTS.slackBlockKit,
      },
    });
    await deps.sendSlack({
      triggerWebhook: webhook,
      triggerName: trigger.name,
      payload: rendered.payload,
    });
    return;
  }

  logger.warn(
    { triggerId: trigger.id, action: trigger.action },
    "Report trigger action is not a notify channel — skipping",
  );
}
