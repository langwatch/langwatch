import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { gatewayConfig } from "../gateway.config.ts";

const read = (source: Record<string, string | undefined>) =>
  parseProcessConfig({
    owners: [{ name: "gateway", config: gatewayConfig }],
    environment: source,
  }).gateway;

describe("gateway server configuration", () => {
  describe("given a deployment sets nothing", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("reads every address and the grace absent, isSaas and loopback voice providers off", () => {
      expect(read({})).toEqual({
        spendSettlementGraceMs: undefined,
        internalUrl: undefined,
        controlPlaneUrl: undefined,
        baseUrl: undefined,
        publicUrl: undefined,
        isSaas: false,
        allowLoopbackVoiceProviders: false,
      });
    });
  });

  describe("given the settlement grace is set", () => {
    /** @scenario "One variable has one owner across every process" */
    it("carries it as written, so the REST policy and the sweeper agree", () => {
      expect(read({ LW_SPEND_SETTLEMENT_GRACE_MS: "90000" }).spendSettlementGraceMs).toBe("90000");
    });
  });
});
