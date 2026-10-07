import type { DataPrivacyScopeFacts } from "@langwatch/data-privacy-contract";
import { ProjectNotFoundError } from "@langwatch/project-contract";

import type { DataPrivacyProjectScopeRepository } from "../repositories/data-privacy-project-scope.repository.ts";

type ProjectKey = Readonly<{ projectId: string; organizationId: string }>;

/**
 * Folds project's lifecycle facts into where each project sits, and answers the chain facts a
 * resolution is built from. A project not yet folded is refused as not found, so a trace job
 * retries until its fact arrives (Alex, 2026-10-06). Spec: data-privacy-resolution-seam.feature
 */
export class DataPrivacyProjectScopeService {
  private constructor(private readonly repository: DataPrivacyProjectScopeRepository) {}

  static create({
    repository,
  }: {
    repository: DataPrivacyProjectScopeRepository;
  }): DataPrivacyProjectScopeService {
    return new DataPrivacyProjectScopeService(repository);
  }

  /** A created fact before 2026-10-06 names no team; it then folds nothing a resolution needs. */
  async projectCreated({
    teamId,
    isPersonal,
    occurredAt,
    ...key
  }: ProjectKey & { teamId?: string; isPersonal?: boolean; occurredAt: number }): Promise<void> {
    if (!teamId) return;
    await this.repository.recordTeam({
      ...key,
      teamId,
      ...(isPersonal === undefined ? {} : { isPersonal }),
      recordedAtMs: occurredAt,
    });
  }

  projectMoved({
    toTeamId,
    occurredAt,
    ...key
  }: ProjectKey & { toTeamId: string; occurredAt: number }): Promise<void> {
    return this.repository.recordTeam({ ...key, teamId: toTeamId, recordedAtMs: occurredAt });
  }

  async departmentAssigned({
    departmentId,
    teamId,
    isPersonal,
    occurredAt,
    ...key
  }: ProjectKey & {
    departmentId: string | null;
    teamId: string;
    isPersonal: boolean;
    occurredAt: number;
  }): Promise<void> {
    await this.repository.recordTeam({ ...key, teamId, isPersonal, recordedAtMs: occurredAt });
    await this.repository.recordDepartment({ ...key, departmentId, recordedAtMs: occurredAt });
  }

  projectArchived({ occurredAt, ...key }: ProjectKey & { occurredAt: number }): Promise<void> {
    return this.repository.recordArchived({ ...key, archivedAtMs: occurredAt });
  }

  /** Throws `ProjectNotFoundError` for a project not folded yet, half folded, or archived. */
  async getScopeFacts({ projectId }: { projectId: string }): Promise<DataPrivacyScopeFacts> {
    const scope = await this.repository.find({ projectId });
    if (!scope || scope.archived || scope.teamId === null || scope.isPersonal === null) {
      throw new ProjectNotFoundError();
    }
    return {
      organizationId: scope.organizationId,
      teamId: scope.teamId,
      projectId,
      departmentId: scope.departmentId,
      isPersonal: scope.isPersonal,
    };
  }
}
