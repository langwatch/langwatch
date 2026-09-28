/** @see specs/langy/langy-deploy-hardening.feature */
import type { LangyServerConfig } from "@langwatch/langy-contract";
import { describe, expect, it } from "vitest";

import { langyWorkerRuntimeOf } from "../langy-worker-runtime.rules.ts";

const config = (overrides: Partial<LangyServerConfig>): LangyServerConfig => ({
  agentUrl: undefined,
  workerCallbackUrl: undefined,
  workerGatewayUrl: undefined,
  mirrorProjectId: undefined,
  gatewayInternalUrl: undefined,
  gatewayPublicUrl: undefined,
  gatewayLegacyUrl: undefined,
  ...overrides,
});

describe("langyWorkerRuntimeOf", () => {
  describe("given the chart sets the in-cluster gateway address", () => {
    /** @scenario "The Langy worker dials the in-cluster gateway, not its public URL" */
    it("prefers LW_GATEWAY_INTERNAL_URL over LW_GATEWAY_PUBLIC_URL", () => {
      const runtime = langyWorkerRuntimeOf({
        config: config({
          gatewayInternalUrl: "http://acme-gateway:80",
          gatewayPublicUrl: "https://gateway.acme.example",
          gatewayLegacyUrl: "http://acme-gateway:80",
        }),
        publicBaseUrl: undefined,
      });

      expect(runtime.workerGatewayBaseUrl).toBe("http://acme-gateway:80");
    });
  });

  describe("given haven's address for a containerized worker", () => {
    it("lets LANGY_WORKER_GATEWAY_URL win over the in-cluster address", () => {
      const runtime = langyWorkerRuntimeOf({
        config: config({
          workerGatewayUrl: "http://host.docker.internal:5563",
          gatewayInternalUrl: "http://acme-gateway:80",
        }),
        publicBaseUrl: undefined,
      });

      expect(runtime.workerGatewayBaseUrl).toBe("http://host.docker.internal:5563");
    });
  });
});
