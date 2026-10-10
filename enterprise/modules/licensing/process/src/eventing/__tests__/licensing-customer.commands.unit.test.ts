/**
 * @vitest-environment node
 * @see enterprise/modules/licensing/specs/licensing.feature
 */
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { RecordContractTermsChangedCommand } from "../licensing-customer.commands.ts";

const ORGANIZATION = "organization_2abcTerms";

function commandAt(occurredAt: number) {
  return {
    tenantId: createTenantId(ORGANIZATION),
    aggregateId: ORGANIZATION,
    type: "lw.licensing.record_contract_terms_changed",
    data: {
      tenantId: ORGANIZATION,
      occurredAt,
      organizationId: ORGANIZATION,
      operatorId: "operator-1",
    },
  };
}

describe("the contract_terms_changed fact", () => {
  describe("when the same operator changes the same organization's terms twice", () => {
    /** @scenario "Each contract_terms_changed fact is its own message" */
    it("carries a different idempotency key for each, keyed by the organization", () => {
      const handler = new RecordContractTermsChangedCommand();

      const [first] = handler.handle(commandAt(1_790_000_000_000));
      const [second] = handler.handle(commandAt(1_790_000_005_000));

      expect(first?.aggregateId).toBe(ORGANIZATION);
      expect(first?.type).toBe("lw.licensing.contract_terms_changed");
      expect(first?.idempotencyKey).not.toBe(second?.idempotencyKey);
    });
  });
});
