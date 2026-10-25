import type { AuthzApi } from "@langwatch/authz-contract";
import type { EvaluationMonitorErrorRateExceededEventData } from "@langwatch/evaluation-contract";
import type { MailRender } from "@langwatch/mail";
import type { MonitorWithEvaluator } from "@langwatch/monitor-contract";
import type { NotificationService } from "@langwatch/notification-contract";
import { createLogger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";
import { fromDate, nowInstant } from "@langwatch/time";
import type { UserApi } from "@langwatch/user-contract";

import type { MonitorRepository } from "../repositories/monitor.repository.ts";
import { monitorAutoPauseReason, monitorDrawerPath } from "../rules/monitor-auto-pause.rules.ts";

const logger = createLogger("langwatch:monitor:auto-pause");

type MonitorAutoPauseDeps = {
  repository: Pick<MonitorRepository, "findById" | "autoPause">;
  projects: Pick<ProjectApi, "findSummaryById" | "findOrganizationId">;
  administrators: Pick<AuthzApi, "findActiveOrganizationAdministrators">;
  users: Pick<UserApi, "getProfiles">;
  mail: Pick<NotificationService, "sendEmail">;
  renderer: Pick<MailRender, "renderMonitorAutoPaused">;
  /** The platform address of a project path; absent where the deployment named no public URL. */
  platformUrl?: (input: { projectSlug: string; path: string }) => string;
};

/**
 * Pauses a monitor whose recent evaluations mostly errored, from evaluation's fact, and emails
 * the organization's admins once. Spec: modules/monitor/specs/monitor-auto-pause.feature
 */
export class MonitorAutoPauseService {
  static create(deps: MonitorAutoPauseDeps): MonitorAutoPauseService {
    return new MonitorAutoPauseService(deps);
  }

  private constructor(private readonly deps: MonitorAutoPauseDeps) {}

  /** Idempotent: a redelivered fact pauses nothing new and sends the same emails again. */
  async pauseFailing(fact: EvaluationMonitorErrorRateExceededEventData): Promise<void> {
    const { repository } = this.deps;
    const key = { id: fact.monitorId, projectId: fact.projectId };
    const monitor = await repository.findById(key);
    if (!monitor) return;

    const applied =
      monitor.enabled && monitor.updatedAt.getTime() === fact.monitorRevision
        ? await repository.autoPause({
            ...key,
            revision: fromDate(monitor.updatedAt),
            pausedAt: nowInstant(),
            reason: monitorAutoPauseReason(fact),
          })
        : false;
    const current = applied ? await repository.findById(key) : monitor;
    // Paused by itself after this fact was recorded, and not switched back on since.
    const pausedAt = current?.autoPausedAt?.getTime() ?? 0;
    if (!current || current.enabled || pausedAt < fact.occurredAt) return;

    logger.warn(
      {
        projectId: fact.projectId,
        monitorId: fact.monitorId,
        runs: fact.runs,
        errors: fact.errors,
      },
      "paused a monitor whose evaluations mostly errored",
    );
    await this.notifyAdmins({ monitor: current, pausedAt, fact });
  }

  private async notifyAdmins({
    monitor,
    pausedAt,
    fact,
  }: {
    monitor: MonitorWithEvaluator;
    pausedAt: number;
    fact: EvaluationMonitorErrorRateExceededEventData;
  }): Promise<void> {
    const { projects, administrators, users, mail, renderer, platformUrl } = this.deps;
    const [project, organizationId] = await Promise.all([
      projects.findSummaryById(fact.projectId),
      projects.findOrganizationId(fact.projectId),
    ]);
    if (!project || !organizationId || !platformUrl) {
      logger.warn(
        { projectId: fact.projectId, monitorId: fact.monitorId },
        "a monitor paused itself, but nobody can be emailed a link to it",
      );
      return;
    }

    const adminIds = await administrators.findActiveOrganizationAdministrators({ organizationId });
    if (adminIds.length === 0) return;
    const profiles = await users.getProfiles({ userIds: adminIds });
    const recipients = profiles.flatMap((profile) =>
      profile.email && !profile.deactivatedAt ? [profile.email] : [],
    );
    if (recipients.length === 0) return;

    const { subject, html } = await renderer.renderMonitorAutoPaused({
      monitorName: monitor.name,
      projectName: project.name,
      runs: fact.runs,
      errors: fact.errors,
      topError: fact.topError,
      monitorUrl: platformUrl({ projectSlug: project.slug, path: monitorDrawerPath(monitor.id) }),
    });
    await Promise.all(
      recipients.map((to) =>
        mail.sendEmail({
          to,
          subject,
          html,
          idempotencyKey: `monitor-auto-paused:${monitor.id}:${pausedAt}:${to}`,
        }),
      ),
    );
  }
}
