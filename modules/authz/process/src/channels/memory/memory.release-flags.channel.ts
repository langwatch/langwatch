import type { FeatureFlagApi, FeatureFlagKey } from "@langwatch/feature-flag-contract";

/** Release flags in memory: off until a test releases one, as the registry defaults them. */
export class MemoryReleaseFlagsChannel implements Pick<FeatureFlagApi, "isEnabled"> {
  readonly #released = new Set<FeatureFlagKey>();

  private constructor() {}

  static create(): MemoryReleaseFlagsChannel {
    return new MemoryReleaseFlagsChannel();
  }

  release({ flag }: { flag: FeatureFlagKey }): void {
    this.#released.add(flag);
  }

  withhold({ flag }: { flag: FeatureFlagKey }): void {
    this.#released.delete(flag);
  }

  async isEnabled(flagKey: FeatureFlagKey): Promise<boolean> {
    return this.#released.has(flagKey);
  }
}
