import type { GuidedOnboardingRecord } from "@langwatch/onboarding-contract";

import { GuidedOnboardingStateRepository } from "../guided-onboarding-state.repository.ts";

/** The deployment without Redis: one process-lifetime map, no persistence. */
export class MemoryGuidedOnboardingStateRepository extends GuidedOnboardingStateRepository {
  readonly #records = new Map<string, GuidedOnboardingRecord>();

  private constructor() {
    super();
  }

  static create(): MemoryGuidedOnboardingStateRepository {
    return new MemoryGuidedOnboardingStateRepository();
  }

  async find(organizationId: string): Promise<GuidedOnboardingRecord | null> {
    return this.#records.get(organizationId) ?? null;
  }

  async write(organizationId: string, record: GuidedOnboardingRecord): Promise<void> {
    this.#records.set(organizationId, record);
  }
}
