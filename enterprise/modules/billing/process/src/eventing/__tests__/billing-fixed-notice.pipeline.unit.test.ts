/**
 * @vitest-environment node
 *
 * billing_fixed_notice: a scheduled process every 15 minutes whose one intent emails each admin
 * whose refused seat change can be finished now, then prunes its own outbox rows.
 * @see specs/licensing/proration-preview.feature
 */
import { intentAccessorOf } from "@langwatch/eventing/testing";
import { describe, expect, it, vi } from "vitest";

import { billingProcessModule } from "../../billing.module.ts";
import { type BillingFixedNoticeDeps } from "../billing-fixed-notice.intent.ts";
import {
  billingFixedNoticeEventing,
  buildBillingFixedNoticePipeline,
} from "../billing-fixed-notice.pipeline.ts";
import {
  BILLING_FIXED_NOTICE_INTERVAL_MS,
  BILLING_FIXED_NOTICE_PIPELINE_NAME,
  BILLING_FIXED_NOTICE_PROCESS_NAME,
  billingFixedNoticeWake,
} from "../billing-fixed-notice.process.ts";

const NOW = Date.parse("2026-11-26T12:00:00Z");
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function built(overrides: Partial<BillingFixedNoticeDeps> = {}) {
  const deps = {
    notice: vi.fn<BillingFixedNoticeDeps["notice"]>(async () => ({ sent: 0, waiting: 0 })),
    deleteDispatchedBefore: vi.fn<BillingFixedNoticeDeps["deleteDispatchedBefore"]>(async () => 0),
    now: () => NOW,
    ...overrides,
  };
  const definition = buildBillingFixedNoticePipeline(deps);
  const process = definition.processManagers.get(BILLING_FIXED_NOTICE_PROCESS_NAME);
  if (!process) throw new Error("the declaration built no billing-fixed notice process manager");
  return { deps, definition, process };
}

async function deliver(process: ReturnType<typeof built>["process"], at: number) {
  await process.config.intents!.notice!.run(
    { scheduledFor: at },
    {
      processName: BILLING_FIXED_NOTICE_PROCESS_NAME,
      projectId: "global",
      processKey: "global",
      tenantId: "global",
      messageKey: `notice:${at}`,
      attempt: 1,
    },
  );
}

function wake(at: number) {
  return billingFixedNoticeWake(
    { lastPassAt: null },
    {
      at,
      now: at,
      key: BILLING_FIXED_NOTICE_PROCESS_NAME,
      projectId: "__global__",
      intent: intentAccessorOf({
        notice: (messageKey, payload) => ({ messageKey, intentType: "notice", payload }),
      }),
    },
  );
}

describe("given billing's billing-fixed notice declaration", () => {
  /** @scenario "The billing-fixed notice runs every 15 minutes" */
  it("is installed with the module and wakes every 15 minutes", () => {
    const { definition, process } = built();

    expect(billingFixedNoticeEventing.pipeline).toBe(BILLING_FIXED_NOTICE_PIPELINE_NAME);
    expect(billingProcessModule.eventing?.pipeline.split(", ")).toContain(
      BILLING_FIXED_NOTICE_PIPELINE_NAME,
    );
    expect(definition.metadata.name).toBe(BILLING_FIXED_NOTICE_PIPELINE_NAME);
    expect(definition.eventSubscribers.size).toBe(0);
    expect(process.config.schedule?.everyMs).toBe(BILLING_FIXED_NOTICE_INTERVAL_MS);
    expect(BILLING_FIXED_NOTICE_INTERVAL_MS).toBe(15 * 60 * 1000);
  });

  describe("when it wakes", () => {
    /** @scenario "The billing-fixed notice runs every 15 minutes" */
    it("asks for one notice pass, keyed by the wake, and records when it ran", () => {
      const first = wake(NOW);
      const redelivered = wake(NOW);

      expect(first.state).toEqual({ lastPassAt: NOW });
      expect(first.intents).toHaveLength(1);
      expect(first.intents?.[0]).toMatchObject({
        intentType: "notice",
        payload: { scheduledFor: NOW },
      });
      expect(first.intents?.[0]?.messageKey).toBe(redelivered.intents?.[0]?.messageKey);
      expect(wake(NOW + BILLING_FIXED_NOTICE_INTERVAL_MS).intents?.[0]?.messageKey).not.toBe(
        first.intents?.[0]?.messageKey,
      );
    });
  });

  describe("when the notice intent runs", () => {
    /** @scenario "The billing-fixed notice runs every 15 minutes" */
    it("runs one pass and prunes its outbox rows older than a week", async () => {
      const { deps, process } = built({
        notice: vi.fn(async () => ({ sent: 1, waiting: 2 })),
      });

      await deliver(process, NOW);

      expect(deps.notice).toHaveBeenCalledTimes(1);
      expect(deps.deleteDispatchedBefore).toHaveBeenCalledWith({
        processName: BILLING_FIXED_NOTICE_PROCESS_NAME,
        before: NOW - WEEK_MS,
      });
    });

    it("swallows a failed outbox retention", async () => {
      const { process } = built({
        deleteDispatchedBefore: vi.fn(async () => {
          throw new Error("process store unavailable");
        }),
      });

      await expect(deliver(process, NOW)).resolves.toBeUndefined();
    });
  });
});
