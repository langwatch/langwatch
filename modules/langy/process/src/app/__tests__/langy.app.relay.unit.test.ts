/**
 * The relay a process opens, on a LangyModule composed over its memory registry.
 * @vitest-environment node
 * @see modules/langy/specs/langy-internal-relay.feature
 */
import type { AgentApi } from "@langwatch/agent-contract";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import {
  EventSourcing,
  EventStoreProducerOnly,
  type EventSourcedQueueProcessor,
} from "@langwatch/eventing";
import {
  EXPERIMENT_TYPES,
  type Experiment,
  type ExperimentApi,
} from "@langwatch/experiment-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import type { GithubApi } from "@langwatch/github-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { NotificationService } from "@langwatch/notification-contract";
import type { OnboardingApi } from "@langwatch/onboarding-contract";
import type { PresenceApi } from "@langwatch/presence-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import type { ScenarioApi } from "@langwatch/scenario-contract";
import type { SecretApi } from "@langwatch/secret-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { MemoryLangyRepositories } from "../../repositories/memory/memory.langy.repositories.ts";
import { mintRunToken, signFrame } from "../../rules/langy-frame-auth.rules.ts";
import { LangyModule } from "../langy.app.ts";

const ORIGIN = "https://app.example.test";
const RUN_TOKEN = mintRunToken();
const TURN = {
  projectId: "project_1",
  userId: "user_1",
  conversationId: "conv_1",
  turnId: "turn_1",
};

const SUMMER_EVAL: Experiment = {
  id: "experiment_1",
  name: "Summer eval",
  type: EXPERIMENT_TYPES[0],
  slug: "summer-eval",
  projectId: TURN.projectId,
  workflowId: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  archivedAt: null,
  workbenchState: null,
  workbenchVersion: 0,
};

/** A producer-only eventing over a queue that drops what it is sent: no Redis, no ClickHouse. */
function producerEventing(): EventSourcing {
  const queue: EventSourcedQueueProcessor<Record<string, unknown>> = {
    send: async () => undefined,
    sendBatch: async () => undefined,
    waitUntilReady: async () => undefined,
    close: async () => undefined,
  };
  return new EventSourcing({
    enabled: true,
    eventStore: EventStoreProducerOnly.create({ processName: "langwatch-test" }),
    queueFactory: () => queue,
    consumersEnabled: false,
    executionTarget: "api",
    processManagerMode: "producer-only",
  });
}

/** A relay opened by LangyModule, over the memory registry its buffer is read back from. */
async function composedRelay() {
  const repositories = MemoryLangyRepositories.create();
  const app = await LangyModule.create({
    dependencies: {
      presence: createApiFixture<PresenceApi>(),
      featureFlags: createApiFixture<FeatureFlagApi>(),
      users: createApiFixture<UserApi>(),
      github: createApiFixture<GithubApi>(),
      gateway: createApiFixture<GatewayApi>(),
      secrets: createApiFixture<SecretApi>(),
      experiments: createApiFixture<ExperimentApi>({
        findById: async ({ id }) => (id === SUMMER_EVAL.id ? SUMMER_EVAL : null),
      }),
      agents: createApiFixture<AgentApi>(),
      prompts: createApiFixture<PromptApi>(),
      datasets: createApiFixture<DatasetApi>(),
      workflows: createApiFixture<WorkflowApi>(),
      monitors: createApiFixture<MonitorApi>(),
      evaluators: createApiFixture<EvaluatorApi>(),
      scenarios: createApiFixture<ScenarioApi>(),
      modelProviders: createApiFixture<ModelProviderApi>(),
      apiKeys: createApiFixture<ApiKeyApi>(),
      authz: createApiFixture<AuthzApi>(),
      projects: createApiFixture<ProjectApi>({
        findSummaryById: async () => ({ name: "Acme", slug: "acme" }),
      }),
      plans: createApiFixture<EntitlementApi>(),
      onboarding: createApiFixture<OnboardingApi>(),
      notifications: createApiFixture<NotificationService>(),
      retention: createApiFixture<DataRetentionApi>(),
    },
    config: {
      agentUrl: undefined,
      workerCallbackUrl: undefined,
      workerGatewayUrl: undefined,
      mirrorProjectId: undefined,
      gatewayInternalUrl: undefined,
      gatewayPublicUrl: undefined,
      gatewayLegacyUrl: undefined,
      publicBaseUrl: ORIGIN,
    },
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
    repositories,
  });
  const registered = producerEventing().register(
    app.conversationPipeline({ participation: "produce" }),
  );
  app.connectConversationCommands(registered.commands);
  // The turn's handoff carries the run token the worker signs its frames with.
  await repositories.turnHandoff.stash({
    projectId: TURN.projectId,
    conversationId: TURN.conversationId,
    turnId: TURN.turnId,
    actorUserId: TURN.userId,
    prompt: "",
    system: "",
    credentials: {
      llmVirtualKey: "vk-test",
      langwatchEndpoint: ORIGIN,
      gatewayBaseUrl: "https://gateway.example.test/v1",
      organizationId: "org_1",
    },
    runToken: RUN_TOKEN,
    permitReserved: false,
  });
  const relay = app.openRelayConnection();
  const buffer = repositories.tokenBuffer.open();

  return {
    push: async (payloads: unknown[]) => {
      for (const payload of payloads) {
        await relay.handle(signFrame(RUN_TOKEN, TURN, JSON.stringify(payload)));
      }
    },
    live: async () =>
      (
        await buffer.readTail({ conversationId: TURN.conversationId, turnId: TURN.turnId })
      ).reads.map((read) => read.entry),
  };
}

const bashCall = ({ id, command, output }: { id: string; command: string; output: string }) => [
  { type: "tool", id, name: "bash", phase: "start", input: { command } },
  { type: "tool", id, name: "bash", phase: "end", input: { command }, output },
];

describe("the relay LangyModule composes", () => {
  describe("when Langy opens a resource the conversation remembered no link for", () => {
    /** @scenario "A navigate with no remembered link opens the resource's page" */
    it("navigates to the resource's own page under the project slug", async () => {
      const relay = await composedRelay();

      await relay.push(
        bashCall({ id: "call_1", command: "langwatch navigate open experiment_1", output: "ok" }),
      );

      expect(await relay.live()).toContainEqual({
        type: "navigate",
        href: "/acme/experiments/summer-eval",
      });
    });

    it("drops a navigate to an id the project cannot resolve", async () => {
      const relay = await composedRelay();

      await relay.push(
        bashCall({
          id: "call_1",
          command: "langwatch navigate open experiment_gone",
          output: "ok",
        }),
      );

      expect((await relay.live()).filter((entry) => entry.type === "navigate")).toEqual([]);
    });
  });

  describe("when a LangWatch capability call runs", () => {
    /** @scenario "A running capability call shows its progress label" */
    it("shows the capability's present-tense label, and clears it when the call settles", async () => {
      const relay = await composedRelay();

      await relay.push(
        bashCall({ id: "call_1", command: "langwatch trace search --format json", output: "{}" }),
      );

      const statuses = (await relay.live()).filter((entry) => entry.type === "status");
      expect(statuses).toEqual([
        { type: "status", status: "Searching traces…" },
        { type: "status", status: "" },
      ]);
    });
  });
});
