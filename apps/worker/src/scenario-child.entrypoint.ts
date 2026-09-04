/**
 * The scenario child process, as its own program.
 *
 * A simulation run executes in a process of its own so its OpenTelemetry
 * provider is the project's rather than the worker's: the parent injects
 * `LANGWATCH_API_KEY` and `LANGWATCH_ENDPOINT`, the SDK reads them at module
 * load, and everything the run reports lands on the customer's own project.
 *
 * The protocol is two pipes and an exit code. Job data arrives as one JSON
 * document on stdin; the last line of stdout is the result document the parent
 * parses; a non-zero exit means the run could not be carried out at all, which
 * is not the same as a scenario that ran and failed its criteria.
 *
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
 * The one egress the run makes on its own account.
 *
 * An HTTP target is a URL the customer typed, dialled from inside the cluster,
 * so it goes through the same metadata-and-redirect fence every other outbound
 * request in the product does rather than through native `fetch`.
 *
 * Neither leg of the policy is decided here. The address fence is the document
 * the parent stated on `LANGWATCH_SCENARIO_EGRESS_POLICY`, resolved from the
 * same `BLOCK_LOCAL_HTTP_CALLS` / `ALLOWED_PROXY_HOSTS` leaves the worker's own
 * outbound calls read, and an absent document fails the run rather than
 * defaulting the fence open. TLS is the parent's other stated decision, carried
 * as the child's `NODE_TLS_REJECT_UNAUTHORIZED` — `resolveChildTlsEnv` relaxes
 * it only for local non-SaaS development, never in production or on SaaS.
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
 * Where the run reports itself.
 *
 * Missing values are a boot failure rather than a default: a child that
 * reported to the SDK's own default endpoint would write one customer's run
 * into somebody else's deployment.
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
