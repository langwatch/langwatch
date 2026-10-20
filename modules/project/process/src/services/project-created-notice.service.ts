import type { EventingCommandSender } from "@langwatch/eventing";
import type { ProjectWithTeam } from "@langwatch/project-contract";
import { nowInstant } from "@langwatch/time";

import type {
  RecordProjectAggregateRuleChangedCommandData,
  RecordProjectRevivedCommandData,
  RecordProjectArchivedCommandData,
  RecordProjectMovedCommandData,
  RecordProjectCreatedCommandData,
  RecordProjectDepartmentAssignedCommandData,
  RecordProjectLegacyKeyRevokedCommandData,
  RecordProjectPresenceSettingChangedCommandData,
  RecordProjectTraceSharingDisabledCommandData,
} from "../eventing/project-lifecycle.events.ts";
import type { ProjectBackfillRow, ProjectRepository } from "../repositories/project.repository.ts";

export type ProjectLifecycleSenders = Readonly<{
  recordProjectCreated: Pick<
    EventingCommandSender<RecordProjectCreatedCommandData>,
    "send" | "sendBatch"
  >;
  recordProjectLegacyKeyRevoked: Pick<
    EventingCommandSender<RecordProjectLegacyKeyRevokedCommandData>,
    "send"
  >;
  recordPresenceSettingChanged: Pick<
    EventingCommandSender<RecordProjectPresenceSettingChangedCommandData>,
    "send" | "sendBatch"
  >;
  recordProjectMoved: Pick<EventingCommandSender<RecordProjectMovedCommandData>, "send">;
  recordProjectArchived: Pick<EventingCommandSender<RecordProjectArchivedCommandData>, "send">;
  recordProjectDepartmentAssigned: Pick<
    EventingCommandSender<RecordProjectDepartmentAssignedCommandData>,
    "send" | "sendBatch"
  >;
  recordProjectTraceSharingDisabled: Pick<
    EventingCommandSender<RecordProjectTraceSharingDisabledCommandData>,
    "send"
  >;
  recordProjectAggregateRuleChanged: Pick<
    EventingCommandSender<RecordProjectAggregateRuleChangedCommandData>,
    "send"
  >;
  recordProjectRevived: Pick<EventingCommandSender<RecordProjectRevivedCommandData>, "send">;
}>;

type NoticeLogger = Readonly<{
  error(payload: Readonly<Record<string, unknown>>, message: string): void;
}>;

type NoticeDependencies = Readonly<{
  logger: NoticeLogger;
  projects: Pick<ProjectRepository, "findWithOrgAdmin" | "findWithTeam">;
}>;

/**
 * Where a new project is recorded as project's event, with the organization's admin and its
 * creator; peers react from their own side (§9). Best effort, as main's inline sync was: a
 * failed record is logged. The sender arrives once the pipeline registers.
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
    const project = await this.dependencies.projects.findWithTeam(input.projectId);
    await this.#send({
      ...input,
      adminUserId: admin?.adminUserId ?? null,
      ...(project ? { teamId: project.teamId, isPersonal: project.isPersonal } : {}),
    });
  }

  async created(
    input: Readonly<{
      projectId: string;
      organizationId: string;
      createdByUserId: string | null;
      teamId: string;
      isPersonal: boolean;
    }>,
  ): Promise<void> {
    try {
      const admin = await this.dependencies.projects.findWithOrgAdmin(input.projectId);
      await this.#send({ ...input, adminUserId: admin?.adminUserId ?? null });
    } catch (error) {
      this.dependencies.logger.error(
        { projectId: input.projectId, error },
        "recording the new project failed; retry the project:record-created-facts step in Ops to record it",
      );
    }
  }

  /**
   * The facts step's page: every project's created fact at its stored creation, then each live
   * project's department and presence setting at `occurredAt`, one batch each, marked backfilled
   * and keyed per project. Throws, so the step retries the page.
   */
  async recordBackfillPage({
    created,
    live,
    occurredAt,
  }: {
    created: readonly ProjectBackfillRow[];
    live: readonly ProjectBackfillRow[];
    occurredAt: number;
  }): Promise<void> {
    const senders = this.#connected();
    if (created.length > 0) {
      await senders.recordProjectCreated.sendBatch(
        created.map((project) => ({
          tenantId: project.id,
          occurredAt: project.createdAt.epochMilliseconds,
          projectId: project.id,
          organizationId: project.organizationId,
          adminUserId: project.adminUserId,
          backfilled: true,
        })),
      );
    }
    if (live.length === 0) return;
    await senders.recordProjectDepartmentAssigned.sendBatch(
      live.map((project) => ({
        tenantId: project.id,
        projectId: project.id,
        organizationId: project.organizationId,
        occurredAt,
        departmentId: project.departmentId,
        teamId: project.teamId,
        isPersonal: project.isPersonal,
        backfilled: true,
      })),
    );
    await senders.recordPresenceSettingChanged.sendBatch(
      live.map((project) => ({
        tenantId: project.id,
        occurredAt,
        projectId: project.id,
        organizationId: project.organizationId,
        presenceEnabled: project.presenceEnabled,
        backfilled: true,
      })),
    );
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

  /** Best effort, as a revocation's record is: the setting is saved, so a failure is logged. */
  async presenceSettingChanged(
    input: Readonly<{
      projectId: string;
      organizationId: string;
      presenceEnabled: boolean;
      changedByUserId: string | null;
    }>,
  ): Promise<void> {
    try {
      await this.#sendPresenceSetting(input);
    } catch (error) {
      this.dependencies.logger.error(
        { projectId: input.projectId, error },
        "recording the presence setting change failed; presence keeps the previous value",
      );
    }
  }

  /** Throws: share revokes the project's links only from this fact, so a lost one must surface. */
  async traceSharingDisabled(
    input: Readonly<{
      projectId: string;
      organizationId: string;
      disabledByUserId: string;
      revokeExistingLinks?: boolean | undefined;
    }>,
  ): Promise<void> {
    await this.#connected().recordProjectTraceSharingDisabled.send({
      tenantId: input.projectId,
      occurredAt: nowInstant().epochMilliseconds,
      ...input,
    });
  }

  /** Best effort: the move is saved, so a failed record is logged; held lineage ages out. */
  async moved(
    input: Readonly<{
      projectId: string;
      organizationId: string;
      fromTeamId: string;
      toTeamId: string;
    }>,
  ): Promise<void> {
    try {
      await this.#connected().recordProjectMoved.send({
        tenantId: input.projectId,
        occurredAt: nowInstant().epochMilliseconds,
        ...input,
      });
    } catch (error) {
      this.dependencies.logger.error(
        { projectId: input.projectId, error },
        "recording the project move failed; authz's held lineage ages out within a minute",
      );
    }
  }

  /** Best effort, as a move's record is. */
  async archived(input: Readonly<{ projectId: string; organizationId: string }>): Promise<void> {
    try {
      await this.#connected().recordProjectArchived.send({
        tenantId: input.projectId,
        occurredAt: nowInstant().epochMilliseconds,
        ...input,
      });
    } catch (error) {
      this.dependencies.logger.error(
        { projectId: input.projectId, error },
        "recording the project archive failed; authz's held lineage ages out within a minute",
      );
    }
  }

  /** Best effort: the rule is saved, and governance's nightly sweep reconciles a missed record. */
  async aggregateRuleChanged(
    input: Readonly<{ projectId: string; organizationId: string; changedByUserId: string }>,
  ): Promise<void> {
    try {
      await this.#connected().recordProjectAggregateRuleChanged.send({
        tenantId: input.projectId,
        occurredAt: nowInstant().epochMilliseconds,
        ...input,
      });
    } catch (error) {
      this.dependencies.logger.error(
        { projectId: input.projectId, error },
        "recording the aggregate rule change failed; governance's nightly sweep reconciles it",
      );
    }
  }

  /** Best effort: a redelivery revives nothing, so the nightly sweep is the retry. */
  async revived(input: Readonly<{ projectId: string; organizationId: string }>): Promise<void> {
    try {
      await this.#connected().recordProjectRevived.send({
        tenantId: input.projectId,
        occurredAt: nowInstant().epochMilliseconds,
        ...input,
      });
    } catch (error) {
      this.dependencies.logger.error(
        { projectId: input.projectId, error },
        "recording the revived project failed; governance's nightly sweep reconciles it",
      );
    }
  }

  /** Best effort, as a move's record is: the department is saved, so a failure is logged. */
  async departmentAssigned(input: Readonly<{ projectId: string }>): Promise<void> {
    try {
      await this.#sendDepartmentAssigned({ projectId: input.projectId, backfilled: false });
    } catch (error) {
      this.dependencies.logger.error(
        { projectId: input.projectId, error },
        "recording the department assignment failed; data privacy keeps the previous department",
      );
    }
  }

  #connected(): ProjectLifecycleSenders {
    const senders = this.#senders;
    if (!senders) throw new Error("project_lifecycle is not registered in this process");
    return senders;
  }

  /** The moment is taken before the read, so a move saved meanwhile is the newer fact. */
  async #sendDepartmentAssigned(
    input: Readonly<{ projectId: string; backfilled: boolean }>,
  ): Promise<boolean> {
    const senders = this.#connected();
    const occurredAt = nowInstant().epochMilliseconds;
    const project = await this.dependencies.projects.findWithTeam(input.projectId);
    if (!project) return false;
    await senders.recordProjectDepartmentAssigned.send(
      departmentFact({ project, occurredAt, backfilled: input.backfilled }),
    );
    return true;
  }

  async #sendPresenceSetting(
    input: Readonly<{
      projectId: string;
      organizationId: string;
      presenceEnabled: boolean;
      changedByUserId?: string | null;
      backfilled?: boolean;
    }>,
  ): Promise<void> {
    const senders = this.#senders;
    if (!senders) throw new Error("project_lifecycle is not registered in this process");
    await senders.recordPresenceSettingChanged.send({
      tenantId: input.projectId,
      occurredAt: nowInstant().epochMilliseconds,
      ...input,
    });
  }

  async #send(
    input: Readonly<{
      projectId: string;
      organizationId: string;
      adminUserId: string | null;
      createdByUserId?: string | null;
      teamId?: string;
      isPersonal?: boolean;
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

function departmentFact({
  project,
  occurredAt,
  backfilled = true,
}: {
  project: ProjectWithTeam;
  occurredAt: number;
  backfilled?: boolean;
}): RecordProjectDepartmentAssignedCommandData {
  return {
    tenantId: project.id,
    projectId: project.id,
    organizationId: project.team.organizationId,
    occurredAt,
    departmentId: project.departmentId,
    teamId: project.teamId,
    isPersonal: project.isPersonal,
    ...(backfilled ? { backfilled: true } : {}),
  };
}
