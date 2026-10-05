/**
 * @see specs/studio/nlp-lambda-cleanup.feature
 * The sweep of the studio's quiet per-project NLP engines, run through the
 * module's own scheduled process manager over the AWS account its fleet secret names.
 */
// @vitest-environment node
import type { AgentApi } from "@langwatch/agent-contract";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { ExperimentApi } from "@langwatch/experiment-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { SecretApi } from "@langwatch/secret-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NLP_LAMBDA_CLEANUP_PROCESS_NAME } from "../../eventing/workflow-nlp-lambda-cleanup.process.ts";
import { MemoryWorkflowRepositories } from "../../repositories/memory/memory.workflow.repositories.ts";
import { WorkflowModule } from "../workflow.app.ts";

/** One AWS account holding a single studio engine that last spoke a month ago. */
const aws = vi.hoisted(() => {
  const sent: { name: string; input: unknown }[] = [];
  const quiet = { lastSpokeAtMs: 0 };
  const answers: Record<string, () => unknown> = {
    ListFunctionsCommand: () => ({ Functions: [{ FunctionName: "langwatch_nlp-project-1" }] }),
    DescribeLogStreamsCommand: () => ({
      logStreams: [{ lastEventTimestamp: quiet.lastSpokeAtMs }],
    }),
    DescribeLogGroupsCommand: () => ({ logGroups: [] }),
  };

  /** Records every command by name and answers the reads the sweep makes. */
  class RecordingAwsClient {
    send(command: { input: unknown }): Promise<unknown> {
      const name = command.constructor.name;
      sent.push({ name, input: command.input });

      return Promise.resolve(answers[name]?.() ?? {});
    }

    destroy(): void {}
  }

  return { sent, quiet, RecordingAwsClient };
});

vi.mock("@aws-sdk/client-lambda", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  LambdaClient: aws.RecordingAwsClient,
}));

vi.mock("@aws-sdk/client-cloudwatch-logs", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  CloudWatchLogsClient: aws.RecordingAwsClient,
}));

const fleet = {
  AWS_REGION: "eu-west-1",
  AWS_ACCESS_KEY_ID: "AKIA_TEST",
  AWS_SECRET_ACCESS_KEY: "test-secret",
  role_arn: "arn:aws:iam::123456789012:role/nlp",
  image_uri: "123456789012.dkr.ecr.eu-west-1.amazonaws.com/nlp:1",
  cache_bucket: "studio-cache",
  subnet_ids: ["subnet-1"],
  security_group_ids: ["sg-1"],
};

/** The app over the memory registry, naming the fleet secret only when one is given. */
async function appWith(fleetSecret?: string): Promise<WorkflowModule> {
  return WorkflowModule.create({
    dependencies: {
      evaluators: createApiFixture<EvaluatorApi>({}, "EvaluatorApi"),
      modelProviders: createApiFixture<ModelProviderApi>({}, "ModelProviderApi"),
      agents: createApiFixture<AgentApi>({}, "AgentApi"),
      authz: createApiFixture<AuthzApi>({}, "AuthzApi"),
      apiKeys: createApiFixture<ApiKeyApi>({}, "ApiKeyApi"),
      experiments: createApiFixture<ExperimentApi>({}, "ExperimentApi"),
      datasets: createApiFixture<DatasetApi>({}, "DatasetApi"),
      monitors: createApiFixture<MonitorApi>({}, "MonitorApi"),
      secrets: createApiFixture<SecretApi>({}, "SecretApi"),
    },
    config: {
      nlpServiceUrl: undefined,
      stagingThresholdBytes: undefined,
      stagingTtlSeconds: 600,
      relayTurnCeilingMs: undefined,
      publicBaseUrl: "https://app.test",
      nlpCodeBlockTimeoutSeconds: void 0,
    },
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets: new ScopedSecrets(async (handle, build) =>
      build(handle === WorkflowModule.secrets.nlpLambdaFleet ? fleetSecret : undefined),
    ),
    repositories: MemoryWorkflowRepositories.create(),
  });
}

beforeEach(() => {
  aws.sent.length = 0;
  aws.quiet.lastSpokeAtMs = Temporal.Now.instant().subtract({ hours: 24 * 30 }).epochMilliseconds;
});

/** Runs the sweep intent the daily wake asks for, as the worker's outbox would. */
async function runSweep(app: WorkflowModule): Promise<void> {
  const process = app
    .nlpLambdaCleanupPipeline({ deleteDispatchedBefore: async () => 0 })
    .processManagers.get(NLP_LAMBDA_CLEANUP_PROCESS_NAME);
  if (!process) throw new Error("the app built no Lambda cleanup process manager");

  await process.config.intents!.sweep!.run(
    { scheduledFor: 0 },
    {
      processName: NLP_LAMBDA_CLEANUP_PROCESS_NAME,
      projectId: "global",
      processKey: "global",
      tenantId: "global",
      messageKey: "sweep:0",
      attempt: 1,
    },
  );
}

describe("the studio's NLP Lambda sweep", () => {
  describe("given a deployment that composed no NLP Lambda account", () => {
    /** @scenario "A deployment that composed no Lambda account sweeps nothing on its daily wake" */
    it("reads nothing and succeeds", async () => {
      await expect(runSweep(await appWith())).resolves.toBeUndefined();
      expect(aws.sent).toEqual([]);
    });
  });

  describe("given a deployment whose studio engines can be swept", () => {
    /** @scenario "A sweep deletes the engines that have been quiet for a week" */
    it("deletes an engine that has not run for a month", async () => {
      await runSweep(await appWith(JSON.stringify(fleet)));

      expect(aws.sent.filter((command) => command.name === "ListFunctionsCommand")).toHaveLength(1);
      expect(aws.sent).toContainEqual({
        name: "DeleteFunctionCommand",
        input: { FunctionName: "langwatch_nlp-project-1" },
      });
    });
  });
});
