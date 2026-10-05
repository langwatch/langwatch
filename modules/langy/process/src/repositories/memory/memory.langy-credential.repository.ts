import { LangyCredentialResolutionError } from "@langwatch/langy-contract";

import { LangyCredentialRepository } from "../langy-credential.repository.ts";
import type { LangyMemoryStore } from "./langy-memory.store.ts";

/** The memory twin of `PrismaLangyCredentialRepository`, over the store's project and key rows. */
export class MemoryLangyCredentialRepository extends LangyCredentialRepository {
  static create(store: LangyMemoryStore): MemoryLangyCredentialRepository {
    return new MemoryLangyCredentialRepository(store);
  }

  private constructor(private readonly store: LangyMemoryStore) {
    super();
  }

  async getProject(projectId: string): Promise<{ organizationId: string }> {
    const project = this.store.projects.get(projectId);
    if (!project) throw new LangyCredentialResolutionError(`Project ${projectId} not found.`);
    return { organizationId: project.organizationId };
  }

  async findVirtualKeyConfigs(input: {
    projectId: string;
    organizationId: string;
  }): Promise<unknown[]> {
    const latest = this.store.virtualKeys
      .filter(
        (key) =>
          key.organizationId === input.organizationId &&
          key.purpose === "LANGY" &&
          key.status === "ACTIVE" &&
          key.projectIds.includes(input.projectId),
      )
      .toSorted((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 1);
    return latest.flatMap((key) => (key.config == null ? [] : [key.config]));
  }

  async findEgressAllowlists(projectId: string): Promise<unknown[]> {
    const allowlist = this.store.projects.get(projectId)?.egressAllowlist;
    return allowlist == null ? [] : [allowlist];
  }

  async saveEgressAllowlist(projectId: string, allowlist: string[] | null): Promise<void> {
    const project = this.store.projects.get(projectId);
    if (!project) throw new Error(`No project ${projectId} to save the egress allow-list on`);
    project.egressAllowlist = allowlist;
  }
}
