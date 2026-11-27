/**
 * Governance facts stored before gateway recorded who made a key change, who the key is for, its
 * purpose and a crossing's period end, read through today's contract.
 * @see modules/gateway/specs/gateway-governance-events.feature
 */
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import {
  recordBudgetCrossingCommandDataSchema,
  recordVkFirstRequestCommandDataSchema,
  recordVkLifecycleCommandDataSchema,
  virtualKeyPurposeSchema,
} from "../index.ts";

/** A lifecycle fact exactly as gateway stored one before the person and purpose fields. */
const storedLifecycle = {
  tenantId: "proj_1",
  organization_id: "org_1",
  virtual_key_id: "vk_1",
  action: "created",
  name: "tenant key",
  display_prefix: "vk-lw-01ABC",
  reason: null,
  occurred_at: 1_753_800_000_000,
};

/** A crossing exactly as gateway stored one before the period end. */
const storedCrossing = {
  tenantId: "proj_1",
  organization_id: "org_1",
  budget_id: "budget_1",
  kind: "threshold_crossed",
  scope_type: "virtual_key",
  bucket_scope_id: "vk_1",
  end_user_id: null,
  virtual_key_id: "vk_1",
  anchor_project_id: null,
  window: "MONTH",
  period_started_at_ms: 1_751_328_000_000,
  limit_usd: "100.000000",
  spent_usd: "84.500000",
  on_breach: "warn",
  occurred_at: 1_753_800_000_000,
};

describe("gateway's governance facts", () => {
  describe("when a lifecycle fact stored before the person fields is read", () => {
    /** @scenario "Governance facts stored before the person and period fields still parse" */
    it("parses, with no actor, principal or purpose", () => {
      const parsed = recordVkLifecycleCommandDataSchema.parse(storedLifecycle);

      expect(parsed).toMatchObject(storedLifecycle);
      expect(parsed.actor_user_id ?? null).toBeNull();
      expect(parsed.principal_user_id ?? null).toBeNull();
      expect(parsed.purpose ?? null).toBeNull();
    });
  });

  describe("when a crossing stored before the period end is read", () => {
    /** @scenario "Governance facts stored before the person and period fields still parse" */
    it("parses, with no period end", () => {
      const parsed = recordBudgetCrossingCommandDataSchema.parse(storedCrossing);

      expect(parsed).toMatchObject(storedCrossing);
      expect(parsed.period_ends_at_ms ?? null).toBeNull();
      expect(parsed).not.toHaveProperty("top_model");
      expect(parsed).not.toHaveProperty("top_model_spend_share");
    });
  });

  describe("when a key budget's crossing names its top model", () => {
    /** @scenario "A key budget's crossing names the model it spent most on" */
    it("parses the model and its share, and refuses a share outside 0 to 1", () => {
      const named = { ...storedCrossing, top_model: "gpt-5-mini", top_model_spend_share: 0.62 };

      expect(recordBudgetCrossingCommandDataSchema.parse(named)).toMatchObject(named);
      expect(() =>
        recordBudgetCrossingCommandDataSchema.parse({ ...named, top_model_spend_share: 62 }),
      ).toThrow(ZodError);
    });
  });

  describe("when a lifecycle fact names each purpose a key row can hold", () => {
    it("parses every one, the fact and the row reading one purpose schema", () => {
      for (const purpose of virtualKeyPurposeSchema.options) {
        const parsed = recordVkLifecycleCommandDataSchema.parse({ ...storedLifecycle, purpose });

        expect(parsed.purpose).toBe(purpose);
      }
    });
  });

  describe("when a lifecycle fact names an unknown purpose", () => {
    it("refuses it, so a new purpose is a contract change rather than a silent USER", () => {
      expect(() =>
        recordVkLifecycleCommandDataSchema.parse({ ...storedLifecycle, purpose: "ROBOT" }),
      ).toThrow(ZodError);
    });
  });

  describe("when a key's first-request fact is read", () => {
    /** @scenario "A key's first admitted request records one first-request fact" */
    it("parses the key and its organization, and refuses one naming no key", () => {
      const fact = {
        tenantId: "proj_1",
        organization_id: "org_1",
        virtual_key_id: "vk_1",
        occurred_at: 1_753_800_000_000,
      };

      expect(recordVkFirstRequestCommandDataSchema.parse(fact)).toEqual(fact);
      expect(() =>
        recordVkFirstRequestCommandDataSchema.parse({ ...fact, virtual_key_id: "" }),
      ).toThrow(ZodError);
    });
  });
});
