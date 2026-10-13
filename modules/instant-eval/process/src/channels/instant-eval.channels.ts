import { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import { InstantEvalJudgeApi } from "@langwatch/instant-eval-judge-contract";
import type { BoundApis } from "@langwatch/process";
import { ProjectApi } from "@langwatch/project-contract";

/** Every channel instant-eval holds, as the container hands them to the module class. */
export interface InstantEvalChannels {
  /** Judges a connected install's texts on LangWatch, against its licence. */
  readonly licensing: LicensingApi;
  /** The project lookups: its organization, its team and an organization's projects. */
  readonly projects: ProjectApi;
  /** LangWatch's classifier and its key, and where a run's or query's spend is recorded. */
  readonly judges: InstantEvalJudgeApi;
}

/**
 * Both tiers bind the three peers: each is only asked a question and answers it, so none is a
 * dependency of the module (Alex, 2026-10-08, round 34; record §5). The judge choice is behaviour
 * and stays in services over these.
 */
export class BoundInstantEvalChannels {
  static readonly requires = [] as const;
  static readonly binds = {
    licensing: LicensingApi,
    projects: ProjectApi,
    judges: InstantEvalJudgeApi,
  } as const;

  static create({
    bound,
  }: {
    bound: BoundApis<typeof BoundInstantEvalChannels.binds>;
  }): InstantEvalChannels {
    return { licensing: bound.licensing, projects: bound.projects, judges: bound.judges };
  }
}
