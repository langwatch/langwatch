import type { Project, Trigger } from "@prisma/client";
import { Cron } from "croner";
import type { ScheduledJobFire } from "~/server/app-layer/scheduler/scheduler.types";
import { extractReportFromTriggerRow } from "~/server/app-layer/automations/report.builder";
import type { ReportSource } from "~/server/app-layer/automations/report.builder";
import { decryptSlackBotToken } from "~/server/app-layer/automations/providers/slack/server";
import {
  type SlackActionParams,
  slackDeliveryMethodOf,
} from "@langwatch/automations/providers/slack";
import type { sendRenderedTriggerEmail } from "~/server/mailer/triggerEmail";
import type { sendRenderedSlackMessage } from "~/server/app-layer/automations/delivery/sendSlackWebhook";
import type { postSlackChatMessage } from "~/server/app-layer/automations/delivery/appSlackWebApi";
import { REPORT_TRIGGER_DEFAULTS } from "@langwatch/automations/templating/defaults";
import { renderTriggerEmail } from "@langwatch/automations/templating/renderEmail";
import {
  renderTriggerSlack,
  type SlackTemplateType,
} from "@langwatch/automations/templating/renderSlack";
import {
  buildReportTemplateContext,
  type ReportChart,
  type ReportTraceRow,
} from "@langwatch/automations/templating/templateContext";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:report-dispatch");

export interface ReportDispatchDeps {
  loadTrigger(params: {
    projectId: string;
    triggerId: string;
  }): Promise<Trigger | null>;
  loadProject(projectId: string): Promise<Project | null>;
  sendEmail: typeof sendRenderedTriggerEmail;
  sendSlack: typeof sendRenderedSlackMessage;
  sendSlackBot: typeof postSlackChatMessage;
  filterSuppressedRecipients: (params: {
    projectId: string;
    triggerId: string;
    emails: string[];
  }) => Promise<string[]>;
  /**
   * The top-N traces matching the report's search query over its schedule
   * window, newest first, as typed rows. Injected by the composition root so
   * this module stays free of the trace-list service and its ClickHouse
   * plumbing. Only called for `traceQuery` report sources. An empty `query`
   * means "everything in the window".
   */
  listReportTraces(params: {
    projectId: string;
    /** Deep-links each row back to the trace. */
    projectSlug: string;
    query: string;
    from: number;
    to: number;
    limit: number;
  }): Promise<ReportTraceRow[]>;
  /**
   * The report's charts — one per panel — over its schedule window. Only
   * called for `customGraph` / `dashboard` report sources.
   */
  loadReportCharts(params: {
    projectId: string;
    source: ReportSource;
    from: number;
    to: number;
  }): Promise<ReportChart[]>;
  /**
   * Record that the report was sent, so it shows up in the automations page's
   * history and last-sent alongside everything else. Without this a report can
   * run for a month and leave no trace that it ever did.
   */
  recordFire(params: {
    projectId: string;
    triggerId: string;
    firedAt: Date;
  }): Promise<void>;
  baseHost: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** A fire summarises at least a minute and at most a year, whatever the cron. */
const MIN_WINDOW_MS = 60 * 1000;
const MAX_WINDOW_MS = 366 * DAY_MS;

/**
 * The span a fire summarises: everything since the report's PREVIOUS scheduled
 * slot, up to the slot being fired. Asking the schedule itself (in the report's
 * own timezone) is the only way to get this right — the previous version
 * pattern-matched the cron's SHAPE, so a monthly report (`0 9 1 * *`) fell
 * through to a 7-day window and quietly dropped three weeks of its own data,
 * while a six-hourly one looked back a full day and re-sent the same day four
 * times over.
 *
 * DST comes out right for free: a daily 09:00 report spanning a spring-forward
 * summarises 23 hours, because that is genuinely how long ago its last slot was.
 *
 * Falls back to a week only when the schedule cannot be read at all (a row we
 * can no longer parse) — dispatch still sends something rather than nothing.
 */
export function reportWindowMs({
  cron,
  timezone,
  slot,
}: {
  cron: string;
  timezone: string;
  slot: Date;
}): number {
  let previous: Date | undefined;
  try {
    [previous] = new Cron(cron, { timezone }).previousRuns(1, slot);
  } catch {
    return WEEK_MS;
  }
  if (!previous) return WEEK_MS;

  const span = slot.getTime() - previous.getTime();
  if (!Number.isFinite(span) || span <= 0) return WEEK_MS;
  return Math.min(Math.max(span, MIN_WINDOW_MS), MAX_WINDOW_MS);
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
 * ADR-044 Phase 3c: the scheduler's report handler. When a report's
 * `ScheduledJob` comes due, load the trigger, fetch the data its source
 * promises (matching traces, or the series behind each chart panel), and
 * dispatch via the SAME notify pipeline alerts use (`renderTriggerEmail` /
 * `renderTriggerSlack` + the rendered-form senders), against
 * `REPORT_TRIGGER_DEFAULTS`. Registered on `schedulerRegistry` for the
 * `reportTrigger` target type.
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

  // Every report carries its DATA, not just a link to it, over the window
  // `[previous slot, this slot]` — exactly the period this fire is responsible
  // for, so a monthly report summarises its month and a daily one its day. A
  // trace-query report sends the traces matching its search query; a graph or
  // dashboard report sends the plotted series of each panel.
  const to = fire.slot.getTime();
  const from =
    to -
    reportWindowMs({
      cron: report.schedule.cron,
      timezone: report.schedule.timezone,
      slot: fire.slot,
    });

  let traces: ReportTraceRow[] = [];
  let charts: ReportChart[] = [];
  if (report.source.kind === "traceQuery") {
    traces = await deps.listReportTraces({
      projectId: fire.projectId,
      projectSlug: project.slug,
      // The Subject facet (ADR-043) — the same search query the author writes
      // and previews in the drawer. Empty means the whole window.
      query: trigger.filterQuery ?? "",
      from,
      to,
      limit: report.source.topN,
    });
  } else {
    charts = await deps.loadReportCharts({
      projectId: fire.projectId,
      source: report.source,
      from,
      to,
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
      sourceKind: report.source.kind,
    },
    viewUrl: viewUrl(report.source, deps.baseHost, project.slug),
    traces,
    charts,
    occurredAt: fire.slot,
    project: { id: project.id, name: project.name, slug: project.slug },
    baseHost: deps.baseHost,
  });

  // `deliver` reports whether the message actually went out — a report with no
  // recipients, no webhook, or an unusable bot connection silently delivers
  // nothing, and recording a fire for it would put a lie in the history.
  const deliver = async (): Promise<boolean> => {
    if (trigger.action === "SEND_EMAIL") {
      const recipients = params.members ?? [];
      if (recipients.length === 0) return false;
      const allowed = await deps.filterSuppressedRecipients({
        projectId: project.id,
        triggerId: trigger.id,
        emails: recipients,
      });
      if (allowed.length === 0) return false;
      const rendered = await renderTriggerEmail({
        subjectTemplate: trigger.emailSubjectTemplate,
        bodyTemplate: trigger.emailBodyTemplate,
        context,
        defaults: REPORT_TRIGGER_DEFAULTS,
      });
      await deps.sendEmail({
        triggerEmails: allowed,
        triggerId: trigger.id,
        projectId: project.id,
        subject: rendered.subject,
        html: rendered.html,
      });
      return true;
    }

    if (trigger.action === "SEND_SLACK_MESSAGE") {
      const templateType: SlackTemplateType | null =
        trigger.slackTemplateType === "block_kit" ? "block_kit" : "string";

      // ADR-041: a bot connection posts via the Web API with the gate open.
      const slackParams = (trigger.actionParams ?? {}) as SlackActionParams;
      if (slackDeliveryMethodOf(slackParams) === "bot") {
        const token = decryptSlackBotToken(slackParams);
        const channel = slackParams.slackChannelId?.trim();
        if (!token || !channel) return false;
        const rendered = await renderTriggerSlack({
          templateType,
          template: trigger.slackTemplate,
          context,
          defaults: REPORT_TRIGGER_DEFAULTS,
          allowGatedBlocks: true,
        });
        await deps.sendSlackBot({
          token,
          channel,
          payload: rendered.payload,
          triggerName: trigger.name,
        });
        return true;
      }

      const webhook = params.slackWebhook ?? null;
      if (!webhook) return false;
      const rendered = await renderTriggerSlack({
        templateType,
        template: trigger.slackTemplate,
        context,
        defaults: REPORT_TRIGGER_DEFAULTS,
      });
      await deps.sendSlack({
        triggerWebhook: webhook,
        triggerName: trigger.name,
        payload: rendered.payload,
      });
      return true;
    }

    logger.warn(
      { triggerId: trigger.id, action: trigger.action },
      "Report trigger action is not a notify channel — skipping",
    );
    return false;
  };

  if (!(await deliver())) return;

  // The report went out — record it, so the automations page can show when it
  // last sent and what it has been doing. Best-effort: a bookkeeping failure
  // must not fail (and so re-run) a report that already reached the customer.
  try {
    await deps.recordFire({
      projectId: project.id,
      triggerId: trigger.id,
      firedAt: fire.slot,
    });
  } catch (error) {
    logger.warn(
      { triggerId: trigger.id, projectId: project.id, error },
      "Report delivered but recording its fire failed",
    );
  }
}
