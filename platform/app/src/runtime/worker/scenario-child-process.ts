import { createLogger } from "@langwatch/observability";
import {
  executeScenarioChild,
  flushScenarioOtelTraces,
  formatScenarioChildError,
  ScenarioHttpPort,
} from "@langwatch/scenario-server";
import { ssrfSafeFetch } from "~/utils/ssrfProtection";
import { resolveScenarioChildProcessConfig } from "./scenario-child.config";
import { parseScenarioChildInput } from "./scenario-child.input";

class AppScenarioHttpPort extends ScenarioHttpPort {
  fetch(input: {
    url: string;
    init: { method: string; headers: Record<string, string>; body?: string };
  }) {
    return ssrfSafeFetch(input.url, input.init);
  }
}

let logger = createLogger("langwatch:scenarios:child");

async function readJobDataFromStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

async function main(): Promise<void> {
  const config = resolveScenarioChildProcessConfig(process.env);
  logger = logger.child(config.logContext);
  const raw = await readJobDataFromStdin();
  const { jobData, telemetry } = parseScenarioChildInput({ raw, config });

  const result = await executeScenarioChild({
    jobData,
    runtime: {
      langwatchEndpoint: telemetry.langwatchEndpoint,
      langwatchApiKey: telemetry.langwatchApiKey,
      verbose: config.verbose,
      httpPort: new AppScenarioHttpPort(),
      logger,
    },
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch(async (error: unknown) => {
  const errorMessage = formatScenarioChildError(error);
  logger.error({ err: errorMessage }, "scenario execution failed");
  await flushScenarioOtelTraces(logger);
  process.stdout.write(`${JSON.stringify({ success: false, error: errorMessage })}\n`);
  process.exitCode = 1;
});
