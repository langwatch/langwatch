/**
 * Seeds the default prompt tags for one organization created before prompt subscribed to
 * `lw.organization.created`, only when it holds no tag. The tenant list comes from the runner.
 * Spec: modules/prompt/specs/prompt.feature
 */
import type { TenantMigrationOutcome } from "@langwatch/system-migrations";

import type { PromptTagRepository } from "../repositories/prompt-tag.repository.ts";

type PromptTagBackfillPeers = Readonly<{
  tags: Pick<PromptTagRepository, "findAll" | "seedForOrg">;
}>;

export class PromptTagBackfillService {
  private constructor(private readonly peers: PromptTagBackfillPeers) {}

  static create({ peers }: { peers: PromptTagBackfillPeers }): PromptTagBackfillService {
    return new PromptTagBackfillService(peers);
  }

  /** True when the organization held no tag and was (or, on a dry run, would be) seeded. */
  async seedTenant({
    organizationId,
    dryRun,
  }: {
    organizationId: string;
    dryRun: boolean;
  }): Promise<{ seeded: boolean }> {
    const held = await this.peers.tags.findAll({ organizationId });
    if (held.length > 0) return { seeded: false };
    if (!dryRun) await this.peers.tags.seedForOrg({ organizationId });
    return { seeded: true };
  }

  /** The tenant step's body: seeds, then proves the organization holds a tag. */
  async migrateTenant({ tenantId }: { tenantId: string }): Promise<TenantMigrationOutcome> {
    const { seeded } = await this.seedTenant({ organizationId: tenantId, dryRun: false });
    const held = await this.peers.tags.findAll({ organizationId: tenantId });
    const report = { kind: "prompt_tags_seeded", seeded, tags: held.length };
    return held.length > 0 ? { status: "finalized", report } : { status: "migrated", report };
  }
}
