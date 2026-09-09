import type { Suite } from "@langwatch/suite-contract";
import type { Instant } from "@langwatch/time";

/**
 * What the Postgres rows say, in memory: the run plans, and the scenario
 * membership a dynamic scope is resolved against. A scenario is the scenario
 * feature's row, so only the three columns a scope reads are kept here.
 */
export type MemoryScenarioRow = Readonly<{
  id: string;
  projectId: string;
  testSuiteId: string | null;
  labels: readonly string[];
  archivedAt: Instant | null;
}>;

/** The rows a memory-backed suite installation reads and writes. */
export class MemorySuiteDatabase {
  readonly plans = new Map<string, Suite>();
  readonly scenarios = new Map<string, MemoryScenarioRow>();

  private constructor() {}

  static create(): MemorySuiteDatabase {
    return new MemorySuiteDatabase();
  }

  /** The project's scenarios, oldest first, archived ones left out. */
  activeScenarios(projectId: string): MemoryScenarioRow[] {
    return [...this.scenarios.values()].filter(
      (scenario) => scenario.projectId === projectId && scenario.archivedAt === null,
    );
  }

  /** The slugs a new plan must not collide with. */
  activeSlugs(projectId: string): string[] {
    return [...this.plans.values()]
      .filter((plan) => plan.projectId === projectId && plan.archivedAt === null)
      .map((plan) => plan.slug);
  }
}
