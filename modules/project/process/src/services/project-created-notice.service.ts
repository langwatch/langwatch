import type { EventingCommandSender } from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import type {
  RecordProjectCreatedCommandData,
  RecordProjectLegacyKeyRevokedCommandData,
} from "../eventing/project-lifecycle.events.ts";
import type { ProjectRepository } from "../repositories/project.repository.ts";

export type ProjectLifecycleSenders = Readonly<{
  recordProjectCreated: Pick<EventingCommandSender<RecordProjectCreatedCommandData>, "send">;
  recordProjectLegacyKeyRevoked: Pick<
    EventingCommandSender<RecordProjectLegacyKeyRevokedCommandData>,
    "send"
  >;
}>;

type NoticeLogger = Readonly<{
  error(payload: Readonly<Record<string, unknown>>, message: string): void;
}>;

type NoticeDependencies = Readonly<{
  logger: NoticeLogger;
  projects: Pick<ProjectRepository, "findWithOrgAdmin" | "findIdsByOrganization">;
}>;

/**
 * Where a new project is recorded as project's event, with the organization's admin at that
 * moment; analytics and nurturing react from their own side (§9). Best effort, as main's inline
 * sync was: a failed record is logged. The sender arrives once the pipeline registers.
 */
export class ProjectCreatedNoticeService {
  static create(dependencies: NoticeDependencies): ProjectCreatedNoticeService {
    return new ProjectCreatedNoticeService(dependencies);
  }

  #senders: ProjectLifecycleSenders | undefined;

  private constructor(private readonly dependencies: NoticeDependencies) {}

  connect(senders: ProjectLifecycleSenders): void {
    this.#senders = senders;
  }

  /** Throws when the record fails, for a subscriber whose delivery the queue retries. */
  async record(input: Readonly<{ projectId: string; organizationId: string }>): Promise<void> {
    const admin = await this.dependencies.projects.findWithOrgAdmin(input.projectId);
    await this.#send({ ...input, adminUserId: admin?.adminUserId ?? null });
  }

  async created(input: Readonly<{ projectId: string; organizationId: string }>): Promise<void> {
    try {
      await this.record(input);
    } catch (error) {
      this.dependencies.logger.error(
        { projectId: input.projectId, error },
        "recording the new project failed; the next deploy's key-map backfill writes its row",
      );
    }
  }

  /**
   * Records every project of one organization again, marked as backfilled. Idempotent: the
   * event keeps its key, and every peer treats a repeat as the same fact.
   */
  async recordExisting(input: Readonly<{ organizationId: string }>): Promise<number> {
    const projectIds = await this.dependencies.projects.findIdsByOrganization(input.organizationId);
    let recorded = 0;
    for (const projectId of projectIds) {
      const found = await this.dependencies.projects.findWithOrgAdmin(projectId);
      if (!found?.organizationId) continue;
      await this.#send({
        projectId,
        organizationId: found.organizationId,
        adminUserId: found.adminUserId,
        backfilled: true,
      });
      recorded += 1;
    }
    return recorded;
  }

  /** Best effort: the revocation has happened, so a failed record is logged, not raised. */
  async legacyKeyRevoked(
    input: Readonly<{ projectId: string; organizationId: string; revokedByUserId: string }>,
  ): Promise<void> {
    try {
      const senders = this.#senders;
      if (!senders) throw new Error("project_lifecycle is not registered in this process");
      await senders.recordProjectLegacyKeyRevoked.send({
        tenantId: input.projectId,
        occurredAt: nowInstant().epochMilliseconds,
        ...input,
      });
    } catch (error) {
      this.dependencies.logger.error(
        { projectId: input.projectId, error },
        "recording the legacy key revocation failed; the status read refreshes on its own",
      );
    }
  }

  async #send(
    input: Readonly<{
      projectId: string;
      organizationId: string;
      adminUserId: string | null;
      backfilled?: boolean;
    }>,
  ): Promise<void> {
    const senders = this.#senders;
    if (!senders) throw new Error("project_lifecycle is not registered in this process");
    await senders.recordProjectCreated.send({
      tenantId: input.projectId,
      occurredAt: nowInstant().epochMilliseconds,
      ...input,
    });
  }
}
