import { createLogger } from "@langwatch/observability";
import { ChildProcessJobDataSchema } from "@langwatch/scenario-contract";
import {
  decodeScenarioLogContext,
  executeScenarioChild,
  flushScenarioOtelTraces,
  formatScenarioChildError,
  ScenarioHttpPort,
} from "@langwatch/scenario-server";
import { ssrfSafeFetch } from "~/utils/ssrfProtection";

class AppScenarioHttpPort extends ScenarioHttpPort {
  fetch(input: {
    url: string;
    init: { method: string; headers: Record<string, string>; body?: string };
  }) {
    return ssrfSafeFetch(input.url, input.init);
  }
}

const logContext = decodeScenarioLogContext(process.env.LANGWATCH_LOG_CONTEXT);
const logger = createLogger("langwatch:scenarios:child").child(logContext);

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
  const raw = await readJobDataFromStdin();
  const jobData = ChildProcessJobDataSchema.parse(JSON.parse(raw));
  const langwatchEndpoint = process.env.LANGWATCH_ENDPOINT;
  const langwatchApiKey = process.env.LANGWATCH_API_KEY;
  if (!langwatchEndpoint || !langwatchApiKey) {
    throw new Error(
      "LANGWATCH_ENDPOINT and LANGWATCH_API_KEY must be set in child process env",
    );
  }

  const result = await executeScenarioChild({
    jobData,
    runtime: {
      langwatchEndpoint,
      langwatchApiKey,
      verbose: process.env.SCENARIO_VERBOSE === "true",
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
