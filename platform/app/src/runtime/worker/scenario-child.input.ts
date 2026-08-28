import { ChildProcessJobDataSchema, type ChildProcessJobData } from "@langwatch/scenario-contract";
import {
  requireScenarioChildTelemetry,
  type ScenarioChildProcessConfig,
} from "./scenario-child.config";

export function parseScenarioChildInput({
  raw,
  config,
}: {
  raw: string;
  config: ScenarioChildProcessConfig;
}): {
  jobData: ChildProcessJobData;
  telemetry: { langwatchEndpoint: string; langwatchApiKey: string };
} {
  const jobData = ChildProcessJobDataSchema.parse(JSON.parse(raw));
  const telemetry = requireScenarioChildTelemetry(config);

  return { jobData, telemetry };
}
