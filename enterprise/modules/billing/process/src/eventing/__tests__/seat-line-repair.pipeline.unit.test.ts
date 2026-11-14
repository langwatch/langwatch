/**
 * @vitest-environment node
 *
 * billing_seat_line_repair: a scheduled process every 15 minutes whose one intent puts back the
 * seat lines Stripe refused to roll back, then prunes its own outbox rows.
 * @see specs/licensing/seat-rotation.feature
 */
import { intentAccessorOf } from "@langwatch/eventing/testing";
import { describe, expect, it, vi } from "vitest";

import { billingProcessModule } from "../../billing.module.ts";
import type { SeatLineRepairOutcome } from "../../services/seat-line-repair.service.ts";
import { type SeatLineRepairDeps } from "../seat-line-repair.intent.ts";
import {
  buildSeatLineRepairPipeline,
  seatLineRepairEventing,
} from "../seat-line-repair.pipeline.ts";
import {
  SEAT_LINE_REPAIR_INTERVAL_MS,
  SEAT_LINE_REPAIR_PIPELINE_NAME,
  SEAT_LINE_REPAIR_PROCESS_NAME,
  seatLineRepairWake,
} from "../seat-line-repair.process.ts";

const NOW = Date.parse("2026-11-06T12:00:00Z");
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const NOTHING_DONE: SeatLineRepairOutcome = { repaired: 0, pending: 0, failed: 0, flagged: 0 };

function built(overrides: Partial<SeatLineRepairDeps> = {}) {
  const deps = {
    repair: vi.fn<SeatLineRepairDeps["repair"]>(async () => NOTHING_DONE),
    deleteDispatchedBefore: vi.fn<SeatLineRepairDeps["deleteDispatchedBefore"]>(async () => 0),
    now: () => NOW,
    ...overrides,
  };
  const definition = buildSeatLineRepairPipeline(deps);
  const process = definition.processManagers.get(SEAT_LINE_REPAIR_PROCESS_NAME);
  if (!process) throw new Error("the declaration built no seat line repair process manager");
  return { deps, definition, process };
}

async function deliver(process: ReturnType<typeof built>["process"], at: number) {
  await process.config.intents!.repair!.run(
    { scheduledFor: at },
    {
      processName: SEAT_LINE_REPAIR_PROCESS_NAME,
      projectId: "global",
      processKey: "global",
      tenantId: "global",
      messageKey: `repair:${at}`,
      attempt: 1,
    },
  );
}

function wake(at: number) {
  return seatLineRepairWake(
    { lastRepairAt: null },
    {
      at,
      now: at,
      key: SEAT_LINE_REPAIR_PROCESS_NAME,
      projectId: "__global__",
      intent: intentAccessorOf({
        repair: (messageKey, payload) => ({ messageKey, intentType: "repair", payload }),
      }),
    },
  );
}

describe("given billing's seat line repair declaration", () => {
  /** @scenario "The seat line repair runs every 15 minutes" */
  it("is installed with the module and wakes every 15 minutes", () => {
    const { definition, process } = built();

    expect(seatLineRepairEventing.pipeline).toBe(SEAT_LINE_REPAIR_PIPELINE_NAME);
    expect(billingProcessModule.eventing?.pipeline.split(", ")).toContain(
      SEAT_LINE_REPAIR_PIPELINE_NAME,
    );
    expect(definition.metadata.name).toBe(SEAT_LINE_REPAIR_PIPELINE_NAME);
    expect(definition.eventSubscribers.size).toBe(0);
    expect(process.config.schedule?.everyMs).toBe(SEAT_LINE_REPAIR_INTERVAL_MS);
    expect(SEAT_LINE_REPAIR_INTERVAL_MS).toBe(15 * 60 * 1000);
  });

  describe("when it wakes", () => {
    /** @scenario "The seat line repair runs every 15 minutes" */
    it("asks for one repair pass, keyed by the wake, and records when it ran", () => {
      const first = wake(NOW);
      const redelivered = wake(NOW);

      expect(first.state).toEqual({ lastRepairAt: NOW });
      expect(first.intents).toHaveLength(1);
      expect(first.intents?.[0]).toMatchObject({
        intentType: "repair",
        payload: { scheduledFor: NOW },
      });
      expect(first.intents?.[0]?.messageKey).toBe(redelivered.intents?.[0]?.messageKey);
      expect(wake(NOW + SEAT_LINE_REPAIR_INTERVAL_MS).intents?.[0]?.messageKey).not.toBe(
        first.intents?.[0]?.messageKey,
      );
    });
  });

  describe("when the repair intent runs", () => {
    it("runs one pass and prunes its outbox rows older than a week", async () => {
      const { deps, process } = built({
        repair: vi.fn(async () => ({ repaired: 1, pending: 0, failed: 1, flagged: 0 })),
      });

      await deliver(process, NOW);

      expect(deps.repair).toHaveBeenCalledTimes(1);
      expect(deps.deleteDispatchedBefore).toHaveBeenCalledWith({
        processName: SEAT_LINE_REPAIR_PROCESS_NAME,
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
