import { ConfigurationError } from "../services/errorHandling.ts";

/**
 * A lane a living pipeline retired at a lane-boundary handover (round 16): jobs a previous release
 * queued under its key drain into the lane that took it over in another pipeline, as `UpcastDrain`
 * drains a former pipeline. Spec: packages/eventing/specs/lane-handover.feature.
 */
export interface RetiredLane {
  /** The retired lane's name, as this pipeline's queued job keys still carry it. */
  readonly jobName: string;
  /** The lane that took it over: its pipeline and its name there (a peer lane's declared name). */
  readonly drainsInto: { readonly pipeline: string; readonly lane: string };
}

/** Refuses, when the pipeline is built, a retired lane it still runs or names twice. */
export function assertRetiredLanesDeclarable({
  pipeline,
  laneNames,
  retiredLanes,
}: {
  pipeline: string;
  laneNames: ReadonlySet<string>;
  retiredLanes: readonly RetiredLane[];
}): void {
  const seen = new Set<string>();
  for (const { jobName, drainsInto } of retiredLanes) {
    const refuse = (details: string) =>
      new ConfigurationError("PipelineBuilder", `Pipeline "${pipeline}" ${details}`, {
        pipeline,
        jobName,
        drainsInto: `${drainsInto.pipeline}:${drainsInto.lane}`,
      });
    if (laneNames.has(jobName)) {
      throw refuse(`retires the lane "${jobName}", which it still declares.`);
    }
    if (seen.has(jobName)) throw refuse(`retires the lane "${jobName}" twice.`);
    seen.add(jobName);
  }
}

/** The registry keys a job of `jobType` under a retired lane drains into: own lane, then peer. */
export function retiredLaneTargetKeys({
  jobType,
  drainsInto,
}: {
  jobType: string;
  drainsInto: RetiredLane["drainsInto"];
}): readonly string[] {
  return [
    `${drainsInto.pipeline}:${jobType}:${drainsInto.lane}`,
    `global:${jobType}:${drainsInto.pipeline}.${drainsInto.lane}`,
  ];
}
