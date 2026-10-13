import {
  type ScenarioExecutionJob,
  type ScenarioResourceClass,
  TARGET_RESOURCE_CLASS,
} from "@langwatch/scenario-contract";

/** True when the job's runtime class is one this worker consumes. */
export function consumesJobClass({
  consumed,
  job,
}: {
  consumed: readonly ScenarioResourceClass[];
  job: Pick<ScenarioExecutionJob, "target">;
}): boolean {
  return consumed.includes(TARGET_RESOURCE_CLASS[job.target.type]);
}
