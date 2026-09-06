import { generateKillSwitchKey, KillSwitchPort, type KillSwitchQuery } from "@langwatch/eventing";
import type { FeatureFlagKey, FeatureFlagService } from "@langwatch/feature-flag-contract";

/**
 * The event-sourcing kill switches, read from the operator flag store.
 * Targeted on `projectId`, which is what a targeting rule matches against
 * and what an event-sourcing tenant id IS here.
 */
export class EventingKillSwitchAdapter extends KillSwitchPort {
  private constructor(private readonly featureFlags: FeatureFlagService) {
    super();
  }

  static create(featureFlags: FeatureFlagService): EventingKillSwitchAdapter {
    return new EventingKillSwitchAdapter(featureFlags);
  }

  async isKilled(query: KillSwitchQuery): Promise<boolean> {
    const key: FeatureFlagKey =
      (query.customKey as FeatureFlagKey | undefined) ??
      generateKillSwitchKey(query.aggregateType, query.componentType, query.componentName);

    return await this.featureFlags.isEnabled(key, {
      kind: "project",
      projectId: query.tenantId,
    });
  }
}
