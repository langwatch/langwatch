/**
 * @vitest-environment node
 * `GatewayModule.getDeploymentAddresses`: what the checkup's gateway rows read.
 */
import { ResourceScope } from "@langwatch/process";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { MemoryGatewayRepositories } from "../../repositories/memory/memory.gateway.repositories.ts";
import { GatewayModule } from "../gateway.app.ts";

const noSecrets = new ScopedSecrets(async (_handle, build) => build(undefined));

function gatewayApp({
  internalUrl,
  controlPlaneUrl,
  baseUrl,
  publicUrl,
}: {
  internalUrl: string | undefined;
  controlPlaneUrl: string | undefined;
  baseUrl?: string;
  publicUrl?: string;
}): Promise<GatewayModule> {
  return GatewayModule.create({
    dependencies: {
      authz: createApiFixture({}),
      projects: createApiFixture({}),
      evaluators: createApiFixture({}),
      evaluations: createApiFixture({}),
      monitors: createApiFixture({}),
      organizations: createApiFixture({}),
      featureFlags: createApiFixture({}),
      modelProviders: createApiFixture({}),
      traces: createApiFixture({}),
      oneTimeReveals: createApiFixture({}),
      apiKeys: createApiFixture({}),
    },
    repositories: MemoryGatewayRepositories.create(),
    config: {
      spendSettlementGraceMs: void 0,
      internalUrl,
      controlPlaneUrl,
      publicBaseUrl: "https://app.acme.example",
      baseUrl,
      publicUrl,
      isSaas: false,
      allowLoopbackVoiceProviders: false,
    },
    resources: new ResourceScope(),
    secrets: noSecrets,
  });
}

describe("GatewayModule.getDeploymentAddresses", () => {
  describe("given the gateway's own addresses are configured", () => {
    it("answers them as configured", async () => {
      const app = await gatewayApp({
        internalUrl: "http://gateway.internal:5563",
        controlPlaneUrl: "http://app.internal:6560",
      });

      expect(app.getDeploymentAddresses()).toEqual({
        baseUrl: "http://gateway.internal:5563",
        publicUrl: void 0,
        expectedControlPlaneUrl: "http://app.internal:6560",
      });
    });
  });

  describe("given no control plane address is configured", () => {
    it("expects the gateway to reach this deployment's public base URL", async () => {
      const app = await gatewayApp({ internalUrl: void 0, controlPlaneUrl: void 0 });

      expect(app.getDeploymentAddresses()).toEqual({
        baseUrl: void 0,
        publicUrl: void 0,
        expectedControlPlaneUrl: "https://app.acme.example",
      });
    });
  });

  describe("given both a public and a legacy base address", () => {
    it("tells apps the public one and reaches the gateway at the base one", async () => {
      const app = await gatewayApp({
        internalUrl: void 0,
        controlPlaneUrl: void 0,
        baseUrl: "https://base.example.com",
        publicUrl: "https://public.example.com",
      });

      expect(app.getDeploymentAddresses()).toMatchObject({
        baseUrl: "https://base.example.com",
        publicUrl: "https://public.example.com",
      });
    });
  });

  describe("given only the legacy base address", () => {
    it("tells apps the base address", async () => {
      const app = await gatewayApp({
        internalUrl: void 0,
        controlPlaneUrl: void 0,
        baseUrl: "https://base.example.com",
      });

      expect(app.getDeploymentAddresses().publicUrl).toBe("https://base.example.com");
    });
  });
});
