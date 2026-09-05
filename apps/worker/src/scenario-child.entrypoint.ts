/**
 * The scenario child process, as its own program.
 * @see specs/scenarios/simulation-runner.feature
 * @see specs/scenarios/child-execution-contract.feature
 */

import { createSsrfUrlValidator, fetchValidatedDestination } from "@langwatch/egress";
import { ChildProcessJobDataSchema, type ChildProcessJobData } from "@langwatch/scenario-contract";
import {
  createChildProcessLogger,
  decodeScenarioEgressPolicy,
  executeScenarioChild,
  flushScenarioOtelTraces,
  formatScenarioChildError,
  SCENARIO_EGRESS_POLICY_ENV,
  ScenarioHttpPort,
  type ScenarioHttpResponse,
} from "@langwatch/scenario-server";

const logger = createChildProcessLogger("langwatch:scenarios:child", process.env);

/**
 * The one egress the run makes on its own account. An HTTP target is a URL the customer typed,
 * dialled from inside the cluster, so it goes through the same metadata-and-redirect fence every
 * other outbound request in the product does rather than through native `fetch`.
 */
class WorkerScenarioChildHttp extends ScenarioHttpPort {
  private readonly validate = createSsrfUrlValidator(
    decodeScenarioEgressPolicy(process.env[SCENARIO_EGRESS_POLICY_ENV]),
  );

  private readonly rejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0";

  async fetch(input: Parameters<ScenarioHttpPort["fetch"]>[0]): Promise<ScenarioHttpResponse> {
    const validated = await this.validate(input.url);
    return fetchValidatedDestination(validated, input.init, {
      rejectUnauthorized: this.rejectUnauthorized,
    });
  }
}

function readJobDataFromStdin(): Promise<ChildProcessJobData> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      try {
        resolve(ChildProcessJobDataSchema.parse(JSON.parse(data)));
      } catch (error) {
        reject(new Error(`Failed to parse job data: ${formatScenarioChildError(error)}`));
      }
    });
    process.stdin.on("error", reject);
  });
}

/**
 * Where the run reports itself. Missing values are a boot failure rather than a default: a child
 * that reported to the SDK's own default endpoint would write one customer's run into somebody
 * else's deployment.
 */
function readTelemetryEnvironment(): { langwatchEndpoint: string; langwatchApiKey: string } {
  const langwatchEndpoint = process.env.LANGWATCH_ENDPOINT;
  const langwatchApiKey = process.env.LANGWATCH_API_KEY;
  if (!langwatchEndpoint || !langwatchApiKey) {
    throw new Error("LANGWATCH_ENDPOINT and LANGWATCH_API_KEY must be set in child process env");
  }
  return { langwatchEndpoint, langwatchApiKey };
}

async function main(): Promise<void> {
  const jobData = await readJobDataFromStdin();
  const result = await executeScenarioChild({
    jobData,
    runtime: {
      ...readTelemetryEnvironment(),
      verbose: process.env.SCENARIO_VERBOSE === "true",
      httpPort: new WorkerScenarioChildHttp(),
      logger,
    },
  });

  // The result line is the last thing the child says. Exit once it is written
  // rather than wait for the event loop to drain: the run's adapters and the
  // SDK can leave handles open, and a child that stays up keeps the parent
  // waiting for its timeout instead of reading the result it already has.
  process.stdout.write(`${JSON.stringify(result)}\n`, () => {
    process.exit(0);
  });
}

main().catch(async (error: unknown) => {
  const message = formatScenarioChildError(error);
  logger.error({ err: message }, "scenario execution failed");
  await flushScenarioOtelTraces(logger);
  process.stdout.write(`${JSON.stringify({ success: false, error: message })}\n`);
  process.exit(1);
});
