/**
 * The relay a process opens, composed the way LangyApp composes it.
 * @vitest-environment node
 * @see modules/langy/specs/langy-internal-relay.feature
 */
import type { AgentApi } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import {
  EXPERIMENT_TYPES,
  type Experiment,
  type ExperimentApi,
} from "@langwatch/experiment-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { SecretApi } from "@langwatch/secret-contract";
import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it } from "vitest";

import { UnavailableLangyWorkerChannel } from "../../channels/unavailable.langy-worker.channel.ts";
import type { LangySessionKeyRepository } from "../../repositories/langy-session-key.repository.ts";
import { MemoryLangyRepositories } from "../../repositories/memory/memory.langy.repositories.ts";
import { LangyTokenBufferRedisRepository } from "../../repositories/redis/redis.langy-token-buffer.repository.ts";
import { mintRunToken, signFrame } from "../../rules/langy-frame-auth.rules.ts";
import { LangyNavigateFallbackService } from "../../services/langy-navigate-fallback.service.ts";
import { LangyNavigateResourceLocatorService } from "../../services/langy-navigate-resource-locator.service.ts";
import { LangySessionKeyService } from "../../services/langy-session-key.service.ts";
import { LangyVirtualKeyGatewayService } from "../../services/langy-virtual-key-gateway.service.ts";
import { LangyWorkerMetricsNullService } from "../../services/langy-worker-metrics-null.service.ts";
import type { LangyService } from "../../services/langy.service.ts";
import { buildLangyInfrastructure } from "../langy-composition.build.ts";
import { LangyModel } from "../langy.members.ts";

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

class NoLangyModel extends LangyModel {
  resolve(): Promise<{ modelId: string }> {
    return Promise.reject(new Error("no model in this test"));
  }
}

/** The conversation the relay records into; only the relay's own reads and records answer. */
const conversations = createApiFixture<LangyService>({
  findRunToken: async () => RUN_TOKEN,
  recordToolCallStarted: async () => undefined,
  recordToolCallCompleted: async () => undefined,
  ingestAgentTurnResult: async () => undefined,
  recordTurnHandoff: async () => undefined,
  recordPlanUpdated: async () => undefined,
});

/** The live buffer's stream commands, reading back what was written (the double has no streams). */
function streamScript() {
  const streams = new Map<string, [string, string[]][]>();
  return {
    xadd: async (...args: unknown[]) => {
      const key = String(args[0]);
      const rows = streams.get(key) ?? [];
      const id = `1-${rows.length + 1}`;
      rows.push([id, args.slice(args.indexOf("*") + 1).map(String)]);
      streams.set(key, rows);
      return id;
    },
    xrange: async (...args: unknown[]) => streams.get(String(args[0])) ?? [],
  };
}

/** A relay opened by the composition, over one Redis double its buffer is read back from. */
function composedRelay() {
  const redis = memoryRedisDouble({ script: streamScript() });
  const built = buildLangyInfrastructure({
    redis,
    config: {
      agentUrl: undefined,
      workerCallbackUrl: undefined,
      workerGatewayUrl: undefined,
      mirrorProjectId: undefined,
      gatewayInternalUrl: undefined,
      gatewayPublicUrl: undefined,
      gatewayLegacyUrl: undefined,
    },
    publicBaseUrl: ORIGIN,
    worker: UnavailableLangyWorkerChannel.create(LangyWorkerMetricsNullService.create()),
    repositories: MemoryLangyRepositories.create(),
    models: new NoLangyModel(),
    sessionKeys: LangySessionKeyService.create({
      repository: createApiFixture<LangySessionKeyRepository>(),
      apiKeys: createApiFixture<ApiKeyApi>(),
      authz: createApiFixture<AuthzApi>(),
      metrics: { record: () => undefined },
    }),
    virtualKeys: LangyVirtualKeyGatewayService.create({
      secrets: createApiFixture<SecretApi>(),
      gateway: createApiFixture<GatewayApi>(),
    }),
    navigateFallback: LangyNavigateFallbackService.create({
      projects: createApiFixture<ProjectApi>({
        findSummaryById: async () => ({ name: "Acme", slug: "acme" }),
      }),
      resources: LangyNavigateResourceLocatorService.create({
        experiments: createApiFixture<ExperimentApi>({
          findById: async ({ id }) => (id === SUMMER_EVAL.id ? SUMMER_EVAL : null),
        }),
        agents: createApiFixture<AgentApi>(),
        publicBaseUrl: ORIGIN,
      }),
      publicBaseUrl: ORIGIN,
    }),
  });
  if (!built.openRelay) throw new Error("a process with Redis composes the relay");
  const relay = built.openRelay(conversations);
  const buffer = LangyTokenBufferRedisRepository.create({ redis });

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

describe("the relay LangyApp composes", () => {
  describe("when Langy opens a resource the conversation remembered no link for", () => {
    /** @scenario "A navigate with no remembered link opens the resource's page" */
    it("navigates to the resource's own page under the project slug", async () => {
      const relay = composedRelay();

      await relay.push(
        bashCall({ id: "call_1", command: "langwatch navigate open experiment_1", output: "ok" }),
      );

      expect(await relay.live()).toContainEqual({
        type: "navigate",
        href: "/acme/experiments/summer-eval",
      });
    });

    it("drops a navigate to an id the project cannot resolve", async () => {
      const relay = composedRelay();

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
      const relay = composedRelay();

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
