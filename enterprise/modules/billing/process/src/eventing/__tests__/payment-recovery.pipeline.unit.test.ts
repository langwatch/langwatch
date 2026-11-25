/**
 * @vitest-environment node
 *
 * billing_payment_recovery: a scheduled process every hour whose one intent sends each open
 * recovery case's due notice, then prunes its own outbox rows.
 * @see ../../../../specs/payment-recovery.feature
 */
import { intentAccessorOf } from "@langwatch/eventing/testing";
import { describe, expect, it } from "vitest";

import { billingProcessModule } from "../../billing.module.ts";
import type { PaymentRecoverySweepOutcome } from "../../services/payment-recovery.service.ts";
import type { PaymentRecoverySweepDeps } from "../payment-recovery.intent.ts";
import {
  buildPaymentRecoveryPipeline,
  paymentRecoveryEventing,
} from "../payment-recovery.pipeline.ts";
import {
  PAYMENT_RECOVERY_INTERVAL_MS,
  PAYMENT_RECOVERY_PIPELINE_NAME,
  PAYMENT_RECOVERY_PROCESS_NAME,
  paymentRecoveryWake,
} from "../payment-recovery.process.ts";

const NOW = Date.parse("2026-11-09T12:00:00Z");
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function built(overrides: Partial<PaymentRecoverySweepDeps> = {}) {
  const sweeps: number[] = [];
  const pruned: { processName: string; before: number }[] = [];
  const deps: PaymentRecoverySweepDeps = {
    sweep: async (): Promise<PaymentRecoverySweepOutcome> => {
      sweeps.push(NOW);
      return { notified: 1, closed: 0, failed: 0 };
    },
    deleteDispatchedBefore: async (params) => {
      pruned.push(params);
      return 0;
    },
    now: () => NOW,
    ...overrides,
  };
  const definition = buildPaymentRecoveryPipeline(deps);
  const process = definition.processManagers.get(PAYMENT_RECOVERY_PROCESS_NAME);
  if (!process) throw new Error("the declaration built no payment recovery process manager");
  return { definition, process, sweeps, pruned };
}

async function deliver(process: ReturnType<typeof built>["process"], at: number) {
  await process.config.intents!.sweep!.run(
    { scheduledFor: at },
    {
      processName: PAYMENT_RECOVERY_PROCESS_NAME,
      projectId: "global",
      processKey: "global",
      tenantId: "global",
      messageKey: `sweep:${at}`,
      attempt: 1,
    },
  );
}

function wake(at: number) {
  return paymentRecoveryWake(
    { lastSweepAt: null },
    {
      at,
      now: at,
      key: PAYMENT_RECOVERY_PROCESS_NAME,
      projectId: "__global__",
      intent: intentAccessorOf({
        sweep: (messageKey, payload) => ({ messageKey, intentType: "sweep", payload }),
      }),
    },
  );
}

describe("given billing's payment recovery declaration", () => {
  it("is installed with the module and wakes every hour", () => {
    const { definition, process } = built();

    expect(paymentRecoveryEventing.pipeline).toBe(PAYMENT_RECOVERY_PIPELINE_NAME);
    expect(billingProcessModule.eventing?.pipeline.split(", ")).toContain(
      PAYMENT_RECOVERY_PIPELINE_NAME,
    );
    expect(definition.eventSubscribers.size).toBe(0);
    expect(process.config.schedule?.everyMs).toBe(PAYMENT_RECOVERY_INTERVAL_MS);
    expect(PAYMENT_RECOVERY_INTERVAL_MS).toBe(60 * 60 * 1000);
  });

  it("asks for one sweep per wake, keyed by the wake", () => {
    const first = wake(NOW);

    expect(first.state).toEqual({ lastSweepAt: NOW });
    expect(first.intents).toHaveLength(1);
    expect(first.intents?.[0]?.messageKey).toBe(wake(NOW).intents?.[0]?.messageKey);
    expect(wake(NOW + PAYMENT_RECOVERY_INTERVAL_MS).intents?.[0]?.messageKey).not.toBe(
      first.intents?.[0]?.messageKey,
    );
  });

  it("runs one sweep and prunes its outbox rows older than a week", async () => {
    const { process, sweeps, pruned } = built();

    await deliver(process, NOW);

    expect(sweeps).toHaveLength(1);
    expect(pruned).toEqual([{ processName: PAYMENT_RECOVERY_PROCESS_NAME, before: NOW - WEEK_MS }]);
  });

  it("swallows a failed outbox retention", async () => {
    const { process } = built({
      deleteDispatchedBefore: async () => {
        throw new Error("process store unavailable");
      },
    });

    await expect(deliver(process, NOW)).resolves.toBeUndefined();
  });
});
