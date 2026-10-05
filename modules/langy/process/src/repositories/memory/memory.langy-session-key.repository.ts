import { ApiKeyNotFoundError } from "@langwatch/api-key-contract";
import { ProjectNotFoundError } from "@langwatch/project-contract";
import type { Instant } from "@langwatch/time";

import {
  LangySessionKeyRepository,
  type LangySessionKeyRecord,
} from "../langy-session-key.repository.ts";
import type { LangyMemoryStore } from "./langy-memory.store.ts";
import { MemoryLangySessionKeyReapRepository } from "./memory.langy-session-key-reap.repository.ts";

/** The memory twin of `PrismaLangySessionKeyRepository`, over the store's project and key rows. */
export class MemoryLangySessionKeyRepository extends LangySessionKeyRepository {
  static create(store: LangyMemoryStore): MemoryLangySessionKeyRepository {
    return new MemoryLangySessionKeyRepository(
      store,
      MemoryLangySessionKeyReapRepository.create(store),
    );
  }

  private constructor(
    private readonly store: LangyMemoryStore,
    private readonly reap: MemoryLangySessionKeyReapRepository,
  ) {
    super();
  }

  async getProjectScope(projectId: string): Promise<{ teamId: string; organizationId: string }> {
    const project = this.store.projects.get(projectId);
    if (!project) throw new ProjectNotFoundError("Project not found", { meta: { projectId } });
    return { teamId: project.teamId, organizationId: project.organizationId };
  }

  async getById(input: { apiKeyId: string; projectId: string }): Promise<LangySessionKeyRecord> {
    const key = this.store.apiKeys.get(input.apiKeyId);
    if (!key) throw new ApiKeyNotFoundError(input.apiKeyId);
    return {
      id: key.id,
      name: key.name,
      revokedAt: key.revokedAt,
      isScopedToProject: key.projectIds.includes(input.projectId),
    };
  }

  async revoke(apiKeyId: string, revokedAt: Instant): Promise<void> {
    const key = this.store.apiKeys.get(apiKeyId);
    if (!key) throw new ApiKeyNotFoundError(apiKeyId);
    key.revokedAt = revokedAt;
  }

  revokeExpiredByName(input: { name: string; now: Instant }): Promise<number> {
    return this.reap.revokeExpiredByName(input);
  }
}
