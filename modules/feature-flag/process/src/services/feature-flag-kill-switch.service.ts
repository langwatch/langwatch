import { generateKillSwitchKey, KillSwitch, type KillSwitchQuery } from "@langwatch/eventing";
import type { FeatureFlagApi, FeatureFlagKey } from "@langwatch/feature-flag-contract";

/**
 * The event-sourcing kill switches, read from the operator flag store.
 * Targeted on `projectId`, which is what a targeting rule matches against
 * and what an event-sourcing tenant id IS here.
 */
export class EventingKillSwitchService extends KillSwitch {
  private constructor(private readonly featureFlags: FeatureFlagApi) {
    super();
  }

  static create(featureFlags: FeatureFlagApi): EventingKillSwitchService {
    return new EventingKillSwitchService(featureFlags);
  }

  async isKilled(query: KillSwitchQuery): Promise<boolean> {
    const key: FeatureFlagKey =
      (query.customKey as FeatureFlagKey | undefined) ??
      generateKillSwitchKey(query.aggregateType, query.componentType, query.componentName);

    return this.featureFlags.isEnabled(key, {
      kind: "project",
      projectId: query.tenantId,
    });
  }
}
