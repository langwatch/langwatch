// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { describe, expect, it } from "vitest";
import { RecordBudgetCrossingCommand, RecordVkLifecycleCommand } from "~/server/event-sourcing/pipelines/governance-events/commands/governanceCommands";
import {
  budgetCrossingToEnvelope,
  vkLifecycleToEnvelope,
} from "../webhooks/governanceEnvelopes";

const lifecycle = (action: "created" | "rotated" | "disabled" | "enabled" | "revoked") => ({
  tenantId: "proj_1",
  organization_id: "org_1",
  virtual_key_id: "vk_1",
  action,
  name: "acme tenant key",
  display_prefix: "vk-lw-01ABC",
  reason: action === "disabled" ? "billing hold" : null,
  occurred_at: 1_753_800_000_000,
});

const crossing = (kind: "threshold_crossed" | "breached") => ({
  tenantId: "proj_1",
  organization_id: "org_1",
  budget_id: "budget_1",
  kind,
  scope_type: "attributed_user",
  bucket_scope_id: "vk_1:user_9",
  end_user_id: "user_9",
  window: "MONTH",
  period_started_at_ms: 1_751_328_000_000,
  limit_usd: "100.000000",
  spent_usd: "84.500000",
  on_breach: "block" as const,
  occurred_at: 1_753_800_000_000,
});

describe("governance envelopes", () => {
  /** @scenario Key lifecycle changes become their own envelope types */
  it("types each lifecycle action with a deterministic id and carries the reason", () => {
    const actions = ["created", "rotated", "disabled", "enabled", "revoked"] as const;
    for (const action of actions) {
      const env = vkLifecycleToEnvelope(lifecycle(action));
      expect(env.type).toBe(`gateway.virtual_key.${action}`);
      expect(env.id).toBe(`vk_1:${action}:1753800000000`);
      expect(env.schema_version).toBe("1");
      expect(env.data.event_id).toBe(env.id);
    }
    expect(vkLifecycleToEnvelope(lifecycle("disabled")).data.reason).toBe(
      "billing hold",
    );
    expect(vkLifecycleToEnvelope(lifecycle("enabled")).data.reason).toBeNull();
  });

  /** @scenario A budget crossing becomes a threshold or breach envelope */
  it("splits crossings into the two families with the full figure set", () => {
    const warn = budgetCrossingToEnvelope(crossing("threshold_crossed"));
    const breach = budgetCrossingToEnvelope(crossing("breached"));
    expect(warn.type).toBe("gateway.budget.threshold_crossed");
    expect(breach.type).toBe("gateway.budget.breached");
    for (const env of [warn, breach]) {
      expect(env.data.bucket_scope_id).toBe("vk_1:user_9");
      expect(env.data.window).toBe("MONTH");
      expect(env.data.period_started_at).toBe(
        new Date(1_751_328_000_000).toISOString(),
      );
      expect(env.data.limit_usd).toBe("100.000000");
      expect(env.data.spent_usd).toBe("84.500000");
    }
    expect(warn.id).not.toBe(breach.id);
  });

  /** @scenario A crossing fires once per bucket per period */
  it("keys crossing idempotency on budget, bucket, kind, and period", async () => {
    const handler = new RecordBudgetCrossingCommand();
    const once = await handler.handle({
      tenantId: "proj_1",
      data: crossing("threshold_crossed"),
    } as never);
    const twice = await handler.handle({
      tenantId: "proj_1",
      data: { ...crossing("threshold_crossed"), spent_usd: "90.000000" },
    } as never);
    expect(once[0]!.idempotencyKey).toBe(twice[0]!.idempotencyKey);
    // A new period mints a new key and may fire again.
    const nextPeriod = await handler.handle({
      tenantId: "proj_1",
      data: {
        ...crossing("threshold_crossed"),
        period_started_at_ms: 1_754_006_400_000,
      },
    } as never);
    expect(nextPeriod[0]!.idempotencyKey).not.toBe(once[0]!.idempotencyKey);
    // Lifecycle appends key on subject, action, and time.
    const vkHandler = new RecordVkLifecycleCommand();
    const disabledOnce = await vkHandler.handle({
      tenantId: "proj_1",
      data: lifecycle("disabled"),
    } as never);
    expect(disabledOnce[0]!.idempotencyKey).toContain("vk:vk_1:disabled");
  });
});
