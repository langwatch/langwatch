import type { BoundApis } from "@langwatch/process";
import { ProjectApi } from "@langwatch/project-contract";

/** Every channel monitor holds, as the container hands them to the module class. */
export interface MonitorChannels {
  /** Whether a project accepts writes: an aggregate refuses every monitor (ADR-175). */
  readonly projects: Pick<ProjectApi, "assertAcceptsWrites">;
}

/**
 * Both tiers bind the project directory: it is only asked a question, so it is no peer
 * (record §5) and project may reach monitor through its own peers without a cycle.
 */
export class BoundMonitorChannels {
  static readonly requires = [] as const;
  static readonly binds = { projects: ProjectApi } as const;

  static create({
    bound,
  }: {
    bound: BoundApis<typeof BoundMonitorChannels.binds>;
  }): MonitorChannels {
    return { projects: bound.projects };
  }
}
