/**
 * The scenario child process, as its own program.
 * @see specs/scenarios/simulation-runner.feature
 * @see specs/scenarios/child-execution-contract.feature
 */

import { zodErrorMessage } from "@langwatch/config";
import { fetchValidatedDestination } from "@langwatch/egress/ssrf/fenced-fetch";
import { createSsrfUrlValidator } from "@langwatch/egress/ssrf/url-validator";
import {
  decodeScenarioEgressPolicy,
  SCENARIO_EGRESS_POLICY_ENV,
  ScenarioChildJobSchema,
  type ScenarioChildJob,
} from "@langwatch/scenario-contract";
// The one import this program still takes from the scenario module: the voice transports stay
// with the live voice session there until it spawns a child of its own (Alex, 2026-09-28).
import {
  createSerializedVoiceAgentAdapter,
  createVoiceTransportRegistry,
} from "@langwatch/scenario-process/scenario-child";

import { HttpNlpFetchChannel } from "./channels/http/http.nlp-fetch.channel.ts";
import type {
  ScenarioHttp,
  ScenarioHttpResponse,
} from "./channels/http/http.serialized-http-agent.channel.ts";
import {
  createChildProcessLogger,
  readScenarioChildEnvironment,
  readScenarioChildVoiceEnvironment,
  scenarioChildEnvironmentSource,
  type ScenarioChildEnvironment,
} from "./config.ts";
import { runAgentTestTurn } from "./services/agent-test-turn.service.ts";
import {
  executeScenarioChild,
  flushScenarioOtelTraces,
  formatScenarioChildError,
  type ScenarioChildRuntime,
} from "./services/scenario-child-execution.service.ts";

const source = scenarioChildEnvironmentSource;
const environment = readScenarioChildEnvironment({
  source,
  egressPolicyKey: SCENARIO_EGRESS_POLICY_ENV,
});
const logger = createChildProcessLogger("langwatch:scenarios:child", source);

/**
 * The one egress the run makes on its own account. An HTTP target is a URL the customer typed,
 * dialled from inside the cluster, so it goes through the same metadata-and-redirect fence every
 * other outbound request in the product does rather than through native `fetch`.
 */
class WorkerScenarioChildHttp implements ScenarioHttp {
  private readonly validate: ReturnType<typeof createSsrfUrlValidator>;
  private readonly rejectUnauthorized: boolean;

  constructor(environment: Pick<ScenarioChildEnvironment, "egressPolicy" | "rejectUnauthorized">) {
    this.validate = createSsrfUrlValidator(decodeScenarioEgressPolicy(environment.egressPolicy));
    this.rejectUnauthorized = environment.rejectUnauthorized;
  }

  async fetch(input: {
    url: string;
    init: { method: string; headers: Record<string, string>; body?: string };
  }): Promise<ScenarioHttpResponse> {
    const validated = await this.validate(input.url);
    return fetchValidatedDestination(validated, input.init, {
      rejectUnauthorized: this.rejectUnauthorized,
    });
  }
}

function readJobDataFromStdin(): Promise<ScenarioChildJob> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      try {
        resolve(ScenarioChildJobSchema.parse(JSON.parse(data)));
      } catch (error) {
        // One line: a ZodError's own message is its issues as pretty-printed
        // JSON, and the run's failure reason shows only its first line, "[".
        reject(new Error(`Failed to parse job data: ${zodErrorMessage(error)}`));
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
  const { langwatchEndpoint, langwatchApiKey } = environment;
  if (!langwatchEndpoint || !langwatchApiKey) {
    throw new Error("LANGWATCH_ENDPOINT and LANGWATCH_API_KEY must be set in child process env");
  }
  return { langwatchEndpoint, langwatchApiKey };
}

function readRuntime(): ScenarioChildRuntime {
  const voiceTransports = createVoiceTransportRegistry(readScenarioChildVoiceEnvironment(source));

  return {
    ...readTelemetryEnvironment(),
    verbose: environment.verbose,
    httpPort: new WorkerScenarioChildHttp(environment),
    logger,
    nlpTimeouts: HttpNlpFetchChannel.timeoutsFromEnvironment(source),
    nlpInternalSecret: environment.nlpInternalSecret,
    voiceAgents: (data) => createSerializedVoiceAgentAdapter({ data, registry: voiceTransports }),
    endVoiceCall: ({ data, adapter }) =>
      voiceTransports[data.voiceTarget.transport].endCall(adapter),
  };
}

/** One agent-test turn, or a whole simulation: the job says which. */
function runJob(job: ScenarioChildJob): Promise<unknown> {
  if ("kind" in job) return runAgentTestTurn({ job, runtime: readRuntime() });

  return executeScenarioChild({ jobData: job, runtime: readRuntime() });
}

async function main(): Promise<void> {
  const result = await runJob(await readJobDataFromStdin());

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
