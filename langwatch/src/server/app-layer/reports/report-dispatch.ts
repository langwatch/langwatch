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
  /**
   * Query the top-N matching traces over the report's schedule window and
   * return them as prerendered row lines (e.g. `"<traceId> — <input snippet>"`)
   * capped for length and safe to `mrkdwn_escape`. Injected by the composition
   * root so this module stays free of the trace-list service and its ClickHouse
   * plumbing. Only called for `traceQuery` report sources.
   */
  listTraceRows(params: {
    projectId: string;
    filters: Record<string, unknown>;
    from: number;
    to: number;
    limit: number;
  }): Promise<string[]>;
  baseHost: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/**
 * Derive a report's trailing look-back window from its cron cadence — the span
 * a fire should summarise ("since the last fire"). Deliberately a shape lookup
 * on the standard 5-field cron, not a full parser:
 *  - a weekday-pinned cron (`m h * * N`) → trailing 7 days;
 *  - a plain daily cron    (`m h * * *`) → trailing 1 day;
 *  - anything else (malformed / day-of-month pinned) → 7 days.
 */
export function reportWindowMs(cron: string): number {
  const fields = cron.trim().split(/\s+/);
  if (fields.length < 5) return WEEK_MS;
  const dayOfMonth = fields[2];
  const dayOfWeek = fields[4];
  if (dayOfWeek !== "*") return WEEK_MS; // e.g. "0 9 * * 1" — weekly
  if (dayOfMonth === "*") return DAY_MS; // e.g. "0 7 * * *" — daily
  return WEEK_MS; // day-of-month pinned / anything else — default
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

  // Trace-query reports render REAL rows: the top-N matching traces over the
  // window `[slot - windowMs, slot]`, where windowMs tracks the cron cadence.
  // customGraph/dashboard sources stay rows-free (charts are a later phase) —
  // they still ship the summary + deep link.
  let rows: string[] = [];
  if (report.source.kind === "traceQuery") {
    const to = fire.slot.getTime();
    const from = to - reportWindowMs(report.schedule.cron);
    rows = await deps.listTraceRows({
      projectId: fire.projectId,
      filters: report.source.filters,
      from,
      to,
      limit: report.source.topN,
    });
  }

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
    rows,
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
