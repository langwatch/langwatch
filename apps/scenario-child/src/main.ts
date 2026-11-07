/**
 * The scenario child process, as its own program.
 * @see specs/scenarios/simulation-runner.feature
 * @see specs/scenarios/child-execution-contract.feature
 */

import { zodErrorMessage } from "@langwatch/config";
import { configureLogger } from "@langwatch/observability";
import { processLoggerConfiguration } from "@langwatch/process/observability-owner";
import {
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
import { WorkerScenarioChildHttp } from "./channels/http/http.worker-egress.channel.ts";
import {
  createChildProcessLogger,
  readScenarioChildEnvironment,
  readScenarioChildVoiceEnvironment,
  scenarioChildEnvironmentSource,
} from "./config.ts";
import { runAgentTestTurn } from "./services/agent-test-turn.service.ts";
import {
  executeScenarioChild,
  flushScenarioOtelTraces,
  scenarioChildFailureLine,
  type ScenarioChildRuntime,
} from "./services/scenario-child-execution.service.ts";

const source = scenarioChildEnvironmentSource;
const environment = readScenarioChildEnvironment({
  source,
  egressPolicyKey: SCENARIO_EGRESS_POLICY_ENV,
});
const { configuration, deprecations } = processLoggerConfiguration({
  environment: source,
  serviceName: "langwatch-scenario-child",
});
configureLogger(configuration);
const logger = createChildProcessLogger("langwatch:scenarios:child", source);
for (const deprecation of deprecations) logger.warn(deprecation);

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
  const line = scenarioChildFailureLine(error);
  logger.error({ err: line.error }, "scenario execution failed");
  await flushScenarioOtelTraces(logger);
  process.stdout.write(`${JSON.stringify(line)}\n`);
  process.exit(1);
});
