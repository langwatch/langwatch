import { ProjectActiveDayRepository } from "../project-active-day.repository.ts";

export class MemoryProjectActiveDayRepository extends ProjectActiveDayRepository {
  private readonly claimed = new Set<string>();

  private constructor() {
    super();
  }

  static create(): MemoryProjectActiveDayRepository {
    return new MemoryProjectActiveDayRepository();
  }

  async claimDay(input: { projectId: string; day: string }): Promise<boolean> {
    const key = `${input.projectId}:${input.day}`;
    if (this.claimed.has(key)) return false;
    this.claimed.add(key);
    return true;
  }
}
