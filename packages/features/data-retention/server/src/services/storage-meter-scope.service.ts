/**
 * Total stored bytes for the projects a scope resolves to, RBAC-filtered to
 * the ones the caller may read.
 *
 * The Data Storage card uses this so the number tracks the page's scope
 * selector (organization / team / project) instead of only ever showing the
 * project on the top nav. Projects are always enumerated FROM the caller's
 * organization — a foreign team or project id resolves to no rows — and then
 * narrowed to `traces:view`, so a wider scope can never surface a project's
 * storage the caller could not otherwise see. Summing delegates to the
 * metering service's per-tenant path, which keeps the hardened ClickHouse
 * settings and the cache owned by the retention service.
 */
import type { DataRetentionService } from "@langwatch/data-retention-contract";
import type {
  DataRetentionDirectoryPort,
  RetentionScopeTarget,
} from "../ports/data-retention-directory.port";
import type { DataRetentionPermissionsPort } from "../ports/data-retention-permissions.port";
import type { RetentionActor } from "./data-retention-policy.service";

export type StorageScopeUsage = Readonly<{
  /** Total stored bytes across every in-scope project the caller can read. */
  totalBytes: number;
  /** How many projects contributed — lets the UI say "across N projects". */
  projectCount: number;
}>;

export type StorageMeterScopeServiceOptions = Readonly<{
  retention: Pick<DataRetentionService, "getTotalStorageBytes" | "getTotalStorageBytesForTenants">;
  directory: DataRetentionDirectoryPort;
  permissions: DataRetentionPermissionsPort;
}>;

export class StorageMeterScopeService {
  static create(options: StorageMeterScopeServiceOptions): StorageMeterScopeService {
    return new StorageMeterScopeService(options);
  }

  private constructor(private readonly options: StorageMeterScopeServiceOptions) {}

  async getScopeUsage(input: {
    projectId: string;
    scope: RetentionScopeTarget;
    actor: RetentionActor;
  }): Promise<StorageScopeUsage> {
    const { projectId, scope, actor } = input;
    const { directory, permissions, retention } = this.options;

    const lineage = await directory.tryGetProjectLineage({ projectId });
    const organizationId = lineage?.organizationId ?? null;

    // Personal-account project (no organization): the scope can only be the
    // project itself, already authorized by the route's project:view guard.
    if (!organizationId) {
      const totalBytes = await retention.getTotalStorageBytes({ tenantId: projectId });
      return { totalBytes, projectCount: 1 };
    }

    const candidates = await directory.listScopeProjects({ organizationId, scope });
    if (candidates.length === 0) {
      return { totalBytes: 0, projectCount: 0 };
    }

    const decided = actor.userId
      ? await permissions.canViewTraces({
          userId: actor.userId,
          organizationId,
          projectIds: candidates.map((project) => project.id),
        })
      : new Map<string, boolean>();

    const authorizedIds = candidates
      .map((project) => project.id)
      .filter((id) => decided.get(id) === true);

    const totalBytes = await retention.getTotalStorageBytesForTenants({
      tenantIds: authorizedIds,
    });
    return { totalBytes, projectCount: authorizedIds.length };
  }
}
