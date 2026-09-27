/**
 * @vitest-environment node
 * @see specs/langy/langy-model-selection.feature
 * @see specs/langy/langy-internal-control-plane.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { LangyServerConfig } from "@langwatch/langy-contract";
import { describe, expect, it } from "vitest";

import { UnavailableLangyWorkerChannel } from "../../channels/unavailable.langy-worker.channel.ts";
import type { LangySessionKeyRepository } from "../../repositories/langy-session-key.repository.ts";
import { MemoryLangyRepositories } from "../../repositories/memory/memory.langy.repositories.ts";
import { LangySessionKeyService } from "../../services/langy-session-key.service.ts";
import { LangyWorkerMetricsNullService } from "../../services/langy-worker-metrics-null.service.ts";
import { buildLangyInfrastructure } from "../langy-composition.build.ts";
import { LangyModel } from "../langy.members.ts";

const NO_ADDRESSES: LangyServerConfig = {
  agentUrl: undefined,
  workerCallbackUrl: undefined,
  workerGatewayUrl: undefined,
  mirrorProjectId: undefined,
  gatewayInternalUrl: undefined,
  gatewayPublicUrl: undefined,
  gatewayLegacyUrl: undefined,
};

class ConfiguredLangyModel extends LangyModel {
  resolve(): Promise<{ modelId: string }> {
    return Promise.resolve({ modelId: "openai/gpt-5-mini" });
  }
}

function build(input: { config?: Partial<LangyServerConfig>; publicBaseUrl?: string }) {
  const sessionKeys = LangySessionKeyService.create({
    repository: createApiFixture<LangySessionKeyRepository>(),
    apiKeys: createApiFixture<ApiKeyApi>(),
    authz: createApiFixture<AuthzApi>(),
    metrics: { record: () => undefined },
  });

  return {
    sessionKeys,
    built: buildLangyInfrastructure({
      redis: null,
      config: { ...NO_ADDRESSES, ...input.config },
      publicBaseUrl: input.publicBaseUrl,
      worker: UnavailableLangyWorkerChannel.create(LangyWorkerMetricsNullService.create()),
      repositories: MemoryLangyRepositories.create(),
      models: new ConfiguredLangyModel(),
      sessionKeys,
    }),
  };
}

describe("buildLangyInfrastructure", () => {
  describe("given the project configured a Langy model", () => {
    /** @scenario "A turn resolves the model the project configured for Langy" */
    it("resolves a turn's model instead of refusing every turn", async () => {
      const { built } = build({});

      await expect(built.turns.models.resolve({ projectId: "project_1" })).resolves.toEqual({
        modelId: "openai/gpt-5-mini",
      });
    });

    it("mints the turn's and the credentials' session keys through one service", () => {
      const { built, sessionKeys } = build({});

      expect(built.turns.sessionKeys).toBe(sessionKeys);
      expect(built.credentials.sessionKeys).toBe(sessionKeys);
    });
  });

  describe("when a turn's credentials are composed", () => {
    /** @scenario "The worker calls back on the deployment's public origin unless told otherwise" */
    it("calls back on the public origin, and on the override when one is set", () => {
      const publicBaseUrl = "https://app.example.test";

      expect(build({ publicBaseUrl }).built.credentials.runtime.workerCallbackUrl).toBe(
        publicBaseUrl,
      );
      expect(
        build({ publicBaseUrl, config: { workerCallbackUrl: "http://host.docker.internal:5560" } })
          .built.credentials.runtime.workerCallbackUrl,
      ).toBe("http://host.docker.internal:5560");
    });

    /** @scenario "The worker reaches the gateway at its internal address before its public one" */
    it("hands the worker the gateway's internal address, and the override over both", () => {
      const gateways = {
        gatewayInternalUrl: "http://gateway.internal:5563",
        gatewayPublicUrl: "https://gateway.example.test",
        gatewayLegacyUrl: "https://legacy.example.test",
      };

      expect(build({ config: gateways }).built.credentials.runtime.workerGatewayBaseUrl).toBe(
        "http://gateway.internal:5563",
      );
      expect(
        build({ config: { ...gateways, workerGatewayUrl: "http://host.docker.internal:5563" } })
          .built.credentials.runtime.workerGatewayBaseUrl,
      ).toBe("http://host.docker.internal:5563");
      expect(
        build({ config: { gatewayLegacyUrl: "https://legacy.example.test" } }).built.credentials
          .runtime.workerGatewayBaseUrl,
      ).toBe("https://legacy.example.test");
    });

    it("hands on the mirror project it was configured with", () => {
      expect(
        build({ config: { mirrorProjectId: "project_mirror" } }).built.credentials.runtime
          .mirrorProjectId,
      ).toBe("project_mirror");
    });
  });
});
