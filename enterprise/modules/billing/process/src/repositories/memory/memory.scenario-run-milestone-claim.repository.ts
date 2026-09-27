import { ScenarioRunMilestoneClaimRepository } from "../scenario-run-milestone-claim.repository.ts";

export class MemoryScenarioRunMilestoneClaimRepository extends ScenarioRunMilestoneClaimRepository {
  private readonly claimed = new Set<string>();

  private constructor() {
    super();
  }

  static create(): MemoryScenarioRunMilestoneClaimRepository {
    return new MemoryScenarioRunMilestoneClaimRepository();
  }

  async claim({ eventId }: { eventId: string }): Promise<boolean> {
    if (this.claimed.has(eventId)) return false;
    this.claimed.add(eventId);
    return true;
  }
}
