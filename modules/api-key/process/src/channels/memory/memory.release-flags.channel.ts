import {
  type FeatureFlagApi,
  type FeatureFlagKey,
  type FeatureFlagTarget,
  pickTargetOrganizationId,
} from "@langwatch/feature-flag-contract";

/** Release flags in memory, per organisation: off until a test releases one, as defaulted. */
export class MemoryReleaseFlagsChannel implements Pick<FeatureFlagApi, "isEnabled"> {
  readonly #released = new Set<string>();

  private constructor() {}

  static create(): MemoryReleaseFlagsChannel {
    return new MemoryReleaseFlagsChannel();
  }

  release({ flag, organizationId }: { flag: FeatureFlagKey; organizationId: string }): void {
    this.#released.add(releaseKey({ flag, organizationId }));
  }

  withhold({ flag, organizationId }: { flag: FeatureFlagKey; organizationId: string }): void {
    this.#released.delete(releaseKey({ flag, organizationId }));
  }

  /** A target naming no organisation is never released, as a tenant-less read fails closed. */
  async isEnabled(flagKey: FeatureFlagKey, target: FeatureFlagTarget): Promise<boolean> {
    const organizationId = pickTargetOrganizationId(target);
    if (organizationId === undefined) return false;
    return this.#released.has(releaseKey({ flag: flagKey, organizationId }));
  }
}

function releaseKey({ flag, organizationId }: { flag: string; organizationId: string }): string {
  return `${organizationId}\u0000${flag}`;
}
