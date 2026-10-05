/**
 * A turn's worker credentials, composed from the module's config, the gateway and project secrets.
 * @vitest-environment node
 * @see specs/langy/langy-internal-control-plane.feature
 * @see modules/langy/specs/langy-virtual-key.feature
 */
import type { GatewayApi } from "@langwatch/gateway-contract";
import type { LangyServerConfig } from "@langwatch/langy-contract";
import { LANGY_VK_SECRET_NAME, type SecretApi } from "@langwatch/secret-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { LangyCredentialRepository } from "../../repositories/langy-credential.repository.ts";
import { langyWorkerRuntimeOf } from "../../rules/langy-worker-runtime.rules.ts";
import { LangyCredentialService } from "../langy-credential.service.ts";
import type { LangySessionKeyMintingService } from "../langy-credential.service.ts";
import { LangyVirtualKeyGatewayService } from "../langy-virtual-key-gateway.service.ts";

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

const PUBLIC_ORIGIN = "https://app.example.test";
const GATEWAYS = {
  gatewayInternalUrl: "http://gateway.internal:5563",
  gatewayPublicUrl: "https://gateway.example.test",
  gatewayLegacyUrl: "https://legacy.example.test",
};

/** The credentials a turn's worker is handed, over `config` as LangyModule composes them. */
function credentialsFor(config: Partial<LangyServerConfig>) {
  const composed = { ...NO_ADDRESSES, ...config };
  return LangyCredentialService.create({
    repository: createApiFixture<LangyCredentialRepository>({
      getProject: async () => ({ organizationId: "org_1" }),
    }),
    sessionKeys: createApiFixture<LangySessionKeyMintingService>(),
    virtualKeys: LangyVirtualKeyGatewayService.create({
      secrets: createApiFixture<SecretApi>({
        getValues: async () => ({ [LANGY_VK_SECRET_NAME]: "vk-stored" }),
      }),
      gateway: createApiFixture<GatewayApi>(),
    }),
    github: { enabled: false, findTurnTokens: () => Promise.resolve([]) },
    runtime: langyWorkerRuntimeOf({ config: composed, publicBaseUrl: composed.publicBaseUrl }),
  }).getOrProvision({
    projectId: "project_1",
    session: { user: { id: "user_1" } },
    mintSessionKey: false,
  });
}

describe("LangyCredentialService", () => {
  describe("when a turn's credentials are composed", () => {
    /** @scenario "The worker calls back on the deployment's public origin unless told otherwise" */
    it("calls back on the public origin, and on the override when one is set", async () => {
      await expect(
        credentialsFor({ publicBaseUrl: PUBLIC_ORIGIN, ...GATEWAYS }),
      ).resolves.toMatchObject({ langwatchEndpoint: PUBLIC_ORIGIN });
      await expect(
        credentialsFor({
          publicBaseUrl: PUBLIC_ORIGIN,
          workerCallbackUrl: "http://host.docker.internal:5560",
          ...GATEWAYS,
        }),
      ).resolves.toMatchObject({ langwatchEndpoint: "http://host.docker.internal:5560" });
    });

    /** @scenario "The worker reaches the gateway at its internal address before its public one" */
    it("hands the worker the gateway's internal address, and the override over both", async () => {
      await expect(
        credentialsFor({ publicBaseUrl: PUBLIC_ORIGIN, ...GATEWAYS }),
      ).resolves.toMatchObject({ gatewayBaseUrl: "http://gateway.internal:5563/v1" });
      await expect(
        credentialsFor({
          publicBaseUrl: PUBLIC_ORIGIN,
          ...GATEWAYS,
          workerGatewayUrl: "http://host.docker.internal:5563",
        }),
      ).resolves.toMatchObject({ gatewayBaseUrl: "http://host.docker.internal:5563/v1" });
      await expect(
        credentialsFor({
          publicBaseUrl: PUBLIC_ORIGIN,
          gatewayLegacyUrl: "https://legacy.example.test",
        }),
      ).resolves.toMatchObject({ gatewayBaseUrl: "https://legacy.example.test/v1" });
    });
  });

  describe("given the process composes Langy with the gateway and project secrets", () => {
    /** @scenario "A conversation's credentials resolve once the project's Langy key is provisioned" */
    it("hands out the project's Langy key rather than refusing that Langy is not enabled", async () => {
      await expect(
        credentialsFor({ publicBaseUrl: PUBLIC_ORIGIN, ...GATEWAYS }),
      ).resolves.toMatchObject({ llmVirtualKey: "vk-stored" });
    });
  });
});
