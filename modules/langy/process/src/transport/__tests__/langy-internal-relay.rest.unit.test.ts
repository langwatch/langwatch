/**
 * The relay route over a LangyModule composed the way a process composes it.
 * @vitest-environment node
 * @see modules/langy/specs/langy-internal-relay.feature
 */
import { EventEmitter } from "node:events";

import type { AgentApi } from "@langwatch/agent-contract";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import { canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { ExperimentApi } from "@langwatch/experiment-contract";
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

import { LangyModule } from "../../app/langy.app.ts";
import { MemoryLangyRepositories } from "../../repositories/memory/memory.langy.repositories.ts";
import { langyInternalRest } from "../langy-internal.rest.ts";

const INTERNAL_SECRET = "relay-test-secret";

/** The deployment's shared bearer, the one secret this composition resolves. */
const deploymentSecrets = new ScopedSecrets(async (_handle, build) => build(INTERNAL_SECRET));

function quietPresence(): PresenceApi {
  return {
    isEnabledForProject: () => Promise.resolve(true),
    update: () => Promise.resolve(),
    leave: () => Promise.resolve(),
    list: () => Promise.resolve([]),
    publishProjectEvent: () => Promise.resolve(),
    broadcastCursor: () => Promise.resolve(),
    events: async function* () {},
    cursors: async function* () {},
    readHints: async function* () {},
    getTenantEmitter: () => new EventEmitter(),
    cleanupTenantEmitter: () => void 0,
  };
}

async function relayRoute() {
  const app = await LangyModule.create({
    dependencies: {
      presence: quietPresence(),
      featureFlags: createApiFixture<FeatureFlagApi>(),
      users: createApiFixture<UserApi>(),
      github: createApiFixture<GithubApi>(),
      gateway: createApiFixture<GatewayApi>(),
      secrets: createApiFixture<SecretApi>(),
      experiments: createApiFixture<ExperimentApi>(),
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
      projects: createApiFixture<ProjectApi>(),
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
      publicBaseUrl: "https://app.example.test",
    },
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets: deploymentSecrets,
    repositories: MemoryLangyRepositories.create(),
  });
  const hono = createRestRuntime({
    identity: app.internalDoor,
    doors: { internal_secret: app.internalDoor },
  }).mount(langyInternalRest.router(), {
    app: () => app,
    onError: (error, context) => canonicalErrorResponse(error, context),
  });
  return (body: string, bearer = INTERNAL_SECRET) =>
    hono.request("http://api.test/api/internal/langy/relay/frames", {
      method: "POST",
      body,
      headers: { "content-type": "application/x-ndjson", authorization: `Bearer ${bearer}` },
    });
}

describe("POST /api/internal/langy/relay/frames", () => {
  describe("given a process that composes Langy over its live buffer", () => {
    /** @scenario "An empty frame stream answers a zero tally" */
    it("answers 200 with nothing applied, duplicated or rejected", async () => {
      const post = await relayRoute();

      const response = await post("");

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        applied: 0,
        duplicate: 0,
        rejected: 0,
        terminal: false,
      });
    });

    it("refuses a stream that does not present the deployment's bearer", async () => {
      const post = await relayRoute();

      const response = await post("", "not-the-secret");

      expect(response.status).toBe(401);
    });

    it("counts an unparseable line as rejected rather than failing the stream", async () => {
      const post = await relayRoute();

      const response = await post("not json\n");

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        applied: 0,
        duplicate: 0,
        rejected: 1,
        terminal: false,
      });
    });
  });
});
