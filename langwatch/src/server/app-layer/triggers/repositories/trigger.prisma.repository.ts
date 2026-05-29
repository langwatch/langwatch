import type { PrismaClient } from "@prisma/client";
import type { TriggerFilters } from "~/server/filters/types";
import type {
  TriggerForTemplating,
  TriggerRepository,
  TriggerSummary,
  TriggerTemplatePatch,
} from "./trigger.repository";

export class PrismaTriggerRepository implements TriggerRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findActiveForProject(projectId: string): Promise<TriggerSummary[]> {
    const triggers = await this.prisma.trigger.findMany({
      where: { projectId, active: true, deleted: false },
      select: {
        id: true,
        projectId: true,
        name: true,
        action: true,
        actionParams: true,
        filters: true,
        alertType: true,
        message: true,
        customGraphId: true,
      },
    });

    return triggers.map((t) => ({
      ...t,
      actionParams: t.actionParams ?? {},
      filters: parseFilters(t.filters),
    }));
  }

  async claimSend({
    triggerId,
    traceId,
    projectId,
  }: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean> {
    // Atomic claim: relies on the @@unique([triggerId, traceId]) constraint
    // on TriggerSent. createMany returns the number of rows actually inserted,
    // so a concurrent dispatcher loses cleanly with count: 0.
    const result = await this.prisma.triggerSent.createMany({
      data: [{ triggerId, traceId, projectId }],
      skipDuplicates: true,
    });
    return result.count === 1;
  }

  async updateLastRunAt(
    triggerId: string,
    projectId: string,
  ): Promise<void> {
    await this.prisma.trigger.update({
      where: { id: triggerId, projectId },
      data: { lastRunAt: Date.now() },
    });
  }

  async findForTemplating(
    triggerId: string,
    projectId: string,
  ): Promise<TriggerForTemplating | null> {
    const trigger = await this.prisma.trigger.findFirst({
      where: { id: triggerId, projectId, deleted: false },
      select: {
        id: true,
        name: true,
        message: true,
        alertType: true,
        action: true,
        actionParams: true,
        slackTemplateType: true,
        slackTemplate: true,
        emailSubjectTemplate: true,
        emailBodyTemplate: true,
        project: { select: { name: true, slug: true } },
      },
    });

    if (!trigger) return null;

    const params = parseActionParams(trigger.actionParams);

    return {
      id: trigger.id,
      name: trigger.name,
      message: trigger.message,
      alertType: trigger.alertType,
      action: trigger.action,
      emailRecipients: params.members,
      slackWebhook: params.slackWebhook,
      slackTemplateType: trigger.slackTemplateType,
      slackTemplate: trigger.slackTemplate,
      emailSubjectTemplate: trigger.emailSubjectTemplate,
      emailBodyTemplate: trigger.emailBodyTemplate,
      projectName: trigger.project.name,
      projectSlug: trigger.project.slug,
    };
  }

  async updateTemplates({
    triggerId,
    projectId,
    patch,
  }: {
    triggerId: string;
    projectId: string;
    patch: TriggerTemplatePatch;
  }): Promise<void> {
    await this.prisma.trigger.update({
      where: { id: triggerId, projectId },
      data: patch,
    });
  }
}

function parseActionParams(raw: unknown): {
  members: string[];
  slackWebhook: string | null;
} {
  const params = (raw && typeof raw === "object" ? raw : {}) as {
    members?: unknown;
    slackWebhook?: unknown;
  };
  const members = Array.isArray(params.members)
    ? params.members.filter((m): m is string => typeof m === "string")
    : [];
  const slackWebhook =
    typeof params.slackWebhook === "string" ? params.slackWebhook : null;
  return { members, slackWebhook };
}

function parseFilters(raw: unknown): TriggerFilters {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as TriggerFilters;
    } catch {
      return {};
    }
  }
  if (raw && typeof raw === "object") {
    return raw as TriggerFilters;
  }
  return {};
}
