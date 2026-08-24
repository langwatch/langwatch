// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { describe, expect, it } from "vitest";
import { GovernanceEventsDeliveryProcessService } from "@langwatch/enterprise-governance-server";
import {
  RecordBudgetCrossingCommand,
  RecordVkLifecycleCommand,
} from "~/server/event-sourcing/pipelines/governance-events/commands/governanceCommands";
import {
  anchoredPeriodStart,
  nextAnchoredResetAt,
} from "~/server/gateway/budgetWindow";

const budgetCrossingToEnvelope =
  GovernanceEventsDeliveryProcessService.budgetCrossingEnvelope;
const vkLifecycleToEnvelope =
  GovernanceEventsDeliveryProcessService.vkLifecycleEnvelope;

const lifecycle = (
  action: "created" | "rotated" | "disabled" | "enabled" | "revoked",
) => ({
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
  virtual_key_id: "vk_1",
  anchor_project_id: null,
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
    const actions = [
      "created",
      "rotated",
      "disabled",
      "enabled",
      "revoked",
    ] as const;
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
      // Lowercase snake is THE wire casing; the event store holds the
      // database's own "MONTH" and the seam converts it.
      expect(env.data.window).toBe("month");
      expect(env.data.period_started_at).toBe(
        new Date(1_751_328_000_000).toISOString(),
      );
      expect(env.data.limit_usd).toBe("100.000000");
      expect(env.data.spent_usd).toBe("84.500000");
    }
    expect(warn.id).not.toBe(breach.id);
  });

  /** @scenario Budget events name the key and project they belong to */
  it("carries virtual_key_id and anchor_project_id as first-class fields", () => {
    const env = budgetCrossingToEnvelope(crossing("breached"));
    // Present as their own fields, not only as the prefix of a composite a
    // consumer would have to parse (and could not split reliably when an end
    // user id contains a colon).
    expect(env.data.virtual_key_id).toBe("vk_1");
    expect(env.data.anchor_project_id).toBeNull();

    const projectScoped = budgetCrossingToEnvelope({
      ...crossing("breached"),
      scope_type: "project",
      bucket_scope_id: "proj_9",
      virtual_key_id: null,
      anchor_project_id: "proj_9",
    });
    expect(projectScoped.data.virtual_key_id).toBeNull();
    expect(projectScoped.data.anchor_project_id).toBe("proj_9");
  });

  /** @scenario Every enum on the webhook payload is lowercase snake */
  it("lowercases every enum it puts on the wire", () => {
    const env = budgetCrossingToEnvelope({
      ...crossing("breached"),
      // As the database spells them, which is what a replayed event holds.
      scope_type: "ATTRIBUTED_USER",
      window: "MONTH",
      on_breach: "block",
    });
    expect(env.data.scope_type).toBe("attributed_user");
    expect(env.data.window).toBe("month");
    expect(env.data.on_breach).toBe("block");
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

  /** @scenario "A breach fires once per anchored period" */
  it("keys an anchored budget's crossings on its own period, not the calendar month", async () => {
    const anchor = new Date("2026-06-17T09:00:00.000Z");
    const insidePeriod = new Date("2026-07-01T00:00:00.000Z");
    const periodStart = anchoredPeriodStart({
      window: "MONTH",
      anchorAt: anchor,
      now: insidePeriod,
    });
    const nextPeriodStart = nextAnchoredResetAt({
      window: "MONTH",
      anchorAt: anchor,
      now: insidePeriod,
    });

    // The anchored period spans the calendar boundary, so its start is the
    // 17th of June, not the 1st of July that the calendar would give.
    expect(periodStart.toISOString()).toBe("2026-06-17T09:00:00.000Z");
    expect(nextPeriodStart.toISOString()).toBe("2026-07-17T09:00:00.000Z");

    const anchored = (at: Date) => ({
      ...crossing("breached"),
      period_started_at_ms: at.getTime(),
    });

    const handler = new RecordBudgetCrossingCommand();
    const first = await handler.handle({
      tenantId: "proj_1",
      data: anchored(periodStart),
    } as never);
    // Crossing again later in the same anchored period is the same event,
    // whatever the spend has climbed to since.
    const again = await handler.handle({
      tenantId: "proj_1",
      data: { ...anchored(periodStart), spent_usd: "500.000000" },
    } as never);
    expect(again[0]!.idempotencyKey).toBe(first[0]!.idempotencyKey);

    // The first crossing after the anchored rollover is a new one, so the
    // customer is told once per period they are actually billed on.
    const afterRollover = await handler.handle({
      tenantId: "proj_1",
      data: anchored(nextPeriodStart),
    } as never);
    expect(afterRollover[0]!.idempotencyKey).not.toBe(first[0]!.idempotencyKey);

    // The envelope id carries the same period, so a webhook consumer
    // deduplicates on exactly the same boundary the command store does.
    expect(budgetCrossingToEnvelope(anchored(periodStart)).id).toBe(
      budgetCrossingToEnvelope({
        ...anchored(periodStart),
        spent_usd: "500.000000",
      }).id,
    );
    expect(budgetCrossingToEnvelope(anchored(nextPeriodStart)).id).not.toBe(
      budgetCrossingToEnvelope(anchored(periodStart)).id,
    );
    expect(
      budgetCrossingToEnvelope(anchored(periodStart)).data.period_started_at,
    ).toBe("2026-06-17T09:00:00.000Z");
  });
});
