import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import type { LangyServerConfig } from "@langwatch/langy-contract";
import { LANGY_VK_SECRET_NAME, type SecretApi } from "@langwatch/secret-contract";
/**
 * @vitest-environment node
 * @see specs/langy/langy-model-selection.feature
 * @see specs/langy/langy-internal-control-plane.feature
 * @see modules/langy/specs/langy-virtual-key.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { UnavailableLangyWorkerChannel } from "../../channels/unavailable.langy-worker.channel.ts";
import type { LangySessionKeyRepository } from "../../repositories/langy-session-key.repository.ts";
import { MemoryLangyRepositories } from "../../repositories/memory/memory.langy.repositories.ts";
import { LangyModel } from "../../services/langy-model.service.ts";
import type { LangyNavigateFallbackService } from "../../services/langy-navigate-fallback.service.ts";
import { LangySessionKeyService } from "../../services/langy-session-key.service.ts";
import { LangyVirtualKeyGatewayService } from "../../services/langy-virtual-key-gateway.service.ts";
import { LangyWorkerMetricsNullService } from "../../services/langy-worker-metrics-null.service.ts";
import { buildLangyInfrastructure } from "../langy-composition.build.ts";

const NO_ADDRESSES: LangyServerConfig = {
  agentUrl: undefined,
  workerCallbackUrl: undefined,
  workerGatewayUrl: undefined,
  mirrorProjectId: undefined,
  gatewayInternalUrl: undefined,
  gatewayPublicUrl: undefined,
  gatewayLegacyUrl: undefined,
  publicBaseUrl: undefined,
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
      config: { ...NO_ADDRESSES, ...input.config },
      publicBaseUrl: input.publicBaseUrl,
      worker: UnavailableLangyWorkerChannel.create(LangyWorkerMetricsNullService.create()),
      repositories: MemoryLangyRepositories.create(),
      models: new ConfiguredLangyModel(),
      sessionKeys,
      virtualKeys: LangyVirtualKeyGatewayService.create({
        secrets: createApiFixture<SecretApi>({
          getValues: async () => ({ [LANGY_VK_SECRET_NAME]: "vk-stored" }),
        }),
        gateway: createApiFixture<GatewayApi>(),
      }),
      navigateFallback: createApiFixture<LangyNavigateFallbackService>(),
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

    /** @scenario "A conversation's credentials resolve once the project's Langy key is provisioned" */
    it("hands out the project's Langy key rather than refusing that Langy is not enabled", async () => {
      await expect(
        build({}).built.credentials.virtualKeys.provision({
          projectId: "project_1",
          organizationId: "org_1",
          actorUserId: "user_1",
        }),
      ).resolves.toBe("vk-stored");
    });

    it("hands on the mirror project it was configured with", () => {
      expect(
        build({ config: { mirrorProjectId: "project_mirror" } }).built.credentials.runtime
          .mirrorProjectId,
      ).toBe("project_mirror");
    });
  });
});
