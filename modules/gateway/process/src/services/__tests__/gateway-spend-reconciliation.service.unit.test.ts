/**
 * The reconciliation reads: what they refuse before touching a store.
 * @see specs/ai-gateway/gateway-spend-rest.feature
 * @see specs/ai-gateway/billing-spend-events.feature
 */
import {
  type GatewaySpendSummariesQuery,
  gatewaySpendSummariesQuerySchema,
} from "@langwatch/gateway-contract";
import { describe, expect, it } from "vitest";

import { encodeSpendSummariesCursor } from "../../rules/gateway-spend-cursor.rules.ts";
import { FixedGatewaySettlementPolicyService } from "../fixed-gateway-settlement-policy.service.ts";
import {
  type GatewaySpendApp,
  GatewaySpendReconciliationService,
} from "../gateway-spend-reconciliation.service.ts";

const NOW = Date.now();
const SETTLED_TO = NOW - 24 * 60 * 60 * 1000;

const unreached = (): never => {
  throw new Error("a store was read before the request was refused");
};

const baseCollaborators: GatewaySpendApp = {
  getSpendEvents: unreached,
  getBudgetSpend: unreached,
  spendEventEnvelope: unreached,
  settlementPolicy: () => FixedGatewaySettlementPolicyService.create(30 * 60 * 1000),
  resolveSpendScope: unreached,
  endUserCaps: unreached,
};

function summariesQuery(overrides: Record<string, string>): GatewaySpendSummariesQuery {
  return gatewaySpendSummariesQuerySchema.parse({
    from: String(SETTLED_TO - 3_600_000),
    to: String(SETTLED_TO),
    ...overrides,
  });
}

describe("reading the summaries with a cursor", () => {
  const sut = GatewaySpendReconciliationService.create({ collaborators: baseCollaborators });

  /** @scenario A garbled cursor is refused, not silently reset */
  /** @scenario A garbled summaries cursor is refused, not silently reset */
  it("refuses a cursor that decodes to nothing, reading nothing", async () => {
    await expect(
      sut.answerSpendSummaries({
        organizationId: "org_1",
        query: summariesQuery({ group_by: "model", cursor: "%%%" }),
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  /** @scenario A cursor from another grouping is refused, not silently restarted */
  it("refuses a cursor minted under a different grouping and says to start again", async () => {
    const cursor = encodeSpendSummariesCursor(["gpt-5-mini", "user_1"]);

    await expect(
      sut.answerSpendSummaries({
        organizationId: "org_1",
        query: summariesQuery({ group_by: "model", cursor }),
      }),
    ).rejects.toMatchObject({
      status: 400,
      error: expect.stringContaining("Start a new walk"),
    });
  });
});
