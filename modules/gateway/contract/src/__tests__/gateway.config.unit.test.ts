import { RuntimeConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";
import { gatewayServerConfigDefinition } from "../gateway.config.ts";

const read = (source: Record<string, unknown>) =>
  RuntimeConfig.create({ name: "gateway", definition: gatewayServerConfigDefinition, source })
    .value;

describe("gateway server configuration", () => {
  describe("given a deployment sets nothing", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("reads its one deployment fact absent, and declares no credential", () => {
      expect(read({})).toEqual({ spendSettlementGraceMs: undefined });
    });
  });

  describe("given the settlement grace is set", () => {
    /** @scenario "One variable has one owner across every process" */
    it("carries it as written, so the REST policy and the sweeper agree", () => {
      expect(read({ LW_SPEND_SETTLEMENT_GRACE_MS: "90000" }).spendSettlementGraceMs).toBe("90000");
    });
  });
});
