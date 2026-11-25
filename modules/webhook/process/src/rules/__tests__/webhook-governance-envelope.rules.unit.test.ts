import type {
  RecordBudgetCrossingCommandData,
  RecordVkLifecycleCommandData,
  VkLifecycleAction,
} from "@langwatch/gateway-contract";
import { describe, expect, it } from "vitest";

import {
  budgetCrossingEnvelope,
  virtualKeyLifecycleEnvelope,
} from "../webhook-governance-envelope.rules.ts";

const lifecycle = (action: VkLifecycleAction): RecordVkLifecycleCommandData => ({
  tenantId: "proj_1",
  organization_id: "org_1",
  virtual_key_id: "vk_1",
  action,
  name: "tenant key",
  display_prefix: "vk-lw-01ABC",
  reason: action === "disabled" ? "billing hold" : null,
  occurred_at: 1_753_800_000_000,
});

const crossing = (
  kind: RecordBudgetCrossingCommandData["kind"],
): RecordBudgetCrossingCommandData => ({
  tenantId: "proj_1",
  organization_id: "org_1",
  budget_id: "budget_1",
  kind,
  scope_type: "attributed_user",
  bucket_scope_id: "vk_1:user_9",
  virtual_key_id: "vk_1",
  anchor_project_id: null,
  end_user_id: "user_9",
  window: "MONTH",
  period_started_at_ms: 1_751_328_000_000,
  limit_usd: "100.000000",
  spent_usd: "84.500000",
  on_breach: "block",
  occurred_at: 1_753_800_000_000,
});

describe("governance envelopes", () => {
  describe("when a key changes state", () => {
    /** @scenario "Key lifecycle changes become their own envelope types" */
    it("types each lifecycle action with a deterministic id and carries the reason", () => {
      const actions = ["created", "rotated", "disabled", "enabled", "revoked"] as const;
      for (const action of actions) {
        const envelope = virtualKeyLifecycleEnvelope(lifecycle(action));
        expect(envelope.type).toBe(`gateway.virtual_key.${action}`);
        expect(envelope.id).toBe(`vk_1:${action}:1753800000000`);
        expect(envelope.schema_version).toBe("1");
        expect(envelope.data.event_id).toBe(envelope.id);
      }
      expect(virtualKeyLifecycleEnvelope(lifecycle("disabled")).data.reason).toBe("billing hold");
      expect(virtualKeyLifecycleEnvelope(lifecycle("enabled")).data.reason).toBeNull();
    });
  });

  describe("when a bucket crosses", () => {
    /** @scenario "A budget crossing becomes a threshold or breach envelope" */
    it("splits crossings into the two families with the full figure set", () => {
      const warn = budgetCrossingEnvelope(crossing("threshold_crossed"));
      const breach = budgetCrossingEnvelope(crossing("breached"));
      expect(warn.type).toBe("gateway.budget.threshold_crossed");
      expect(breach.type).toBe("gateway.budget.breached");
      for (const envelope of [warn, breach]) {
        expect(envelope.data).toMatchObject({
          bucket_scope_id: "vk_1:user_9",
          window: "month",
          period_started_at: new Date(1_751_328_000_000).toISOString(),
          limit_usd: "100.000000",
          spent_usd: "84.500000",
        });
      }
      expect(warn.id).not.toBe(breach.id);
    });

    /** @scenario "Budget events name the key and project they belong to" */
    it("carries virtual_key_id and anchor_project_id as their own fields", () => {
      const keyed = budgetCrossingEnvelope(crossing("breached"));
      expect(keyed.data.virtual_key_id).toBe("vk_1");
      expect(keyed.data.anchor_project_id).toBeNull();

      const projectScoped = budgetCrossingEnvelope({
        ...crossing("breached"),
        scope_type: "project",
        bucket_scope_id: "proj_9",
        virtual_key_id: null,
        anchor_project_id: "proj_9",
      });
      expect(projectScoped.data.virtual_key_id).toBeNull();
      expect(projectScoped.data.anchor_project_id).toBe("proj_9");
    });

    /** @scenario "Every enum on the webhook payload is lowercase snake" */
    it("lowercases every enum it puts on the wire", () => {
      const envelope = budgetCrossingEnvelope({
        ...crossing("breached"),
        scope_type: "ATTRIBUTED_USER",
        window: "MONTH",
      });
      expect(envelope.data).toMatchObject({
        scope_type: "attributed_user",
        window: "month",
        on_breach: "block",
      });
    });
  });
});
