/**
 * @vitest-environment node
 *
 * organization_seat_hold_check: an hourly scheduled process whose one intent admits the people
 * waiting where seat holds ended, then prunes its own outbox rows.
 * @see specs/licensing/seat-rotation.feature
 */
import { intentAccessorOf } from "@langwatch/eventing/testing";
import { describe, expect, it, vi } from "vitest";

import { organizationProcessModule } from "../../organization.module.ts";
import type { SeatHoldCheckOutcome } from "../../services/seat-hold.service.ts";
import { type SeatHoldCheckDeps } from "../seat-hold-check.intent.ts";
import { buildSeatHoldCheckPipeline, seatHoldCheckEventing } from "../seat-hold-check.pipeline.ts";
import {
  SEAT_HOLD_CHECK_INTERVAL_MS,
  SEAT_HOLD_CHECK_PIPELINE_NAME,
  SEAT_HOLD_CHECK_PROCESS_NAME,
  seatHoldCheckWake,
} from "../seat-hold-check.process.ts";

const NOW = Date.parse("2026-11-06T12:00:00Z");
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const NOTHING_DONE: SeatHoldCheckOutcome = { admitted: 0, failures: [] };

function built(overrides: Partial<SeatHoldCheckDeps> = {}) {
  const deps = {
    check: vi.fn<SeatHoldCheckDeps["check"]>(async () => NOTHING_DONE),
    deleteDispatchedBefore: vi.fn<SeatHoldCheckDeps["deleteDispatchedBefore"]>(async () => 0),
    now: () => NOW,
    ...overrides,
  };
  const definition = buildSeatHoldCheckPipeline(deps);
  const process = definition.processManagers.get(SEAT_HOLD_CHECK_PROCESS_NAME);
  if (!process) throw new Error("the declaration built no seat hold check process manager");
  return { deps, definition, process };
}

async function deliver(process: ReturnType<typeof built>["process"], at: number) {
  await process.config.intents!.check!.run(
    { scheduledFor: at },
    {
      processName: SEAT_HOLD_CHECK_PROCESS_NAME,
      projectId: "global",
      processKey: "global",
      tenantId: "global",
      messageKey: `check:${at}`,
      attempt: 1,
    },
  );
}

function wake(at: number) {
  return seatHoldCheckWake(
    { lastCheckAt: null },
    {
      at,
      now: at,
      key: SEAT_HOLD_CHECK_PROCESS_NAME,
      projectId: "__global__",
      intent: intentAccessorOf({
        check: (messageKey, payload) => ({ messageKey, intentType: "check", payload }),
      }),
    },
  );
}

describe("given organization's seat hold check declaration", () => {
  it("is installed with the module and wakes every hour", () => {
    const { definition, process } = built();

    expect(seatHoldCheckEventing.pipeline).toBe(SEAT_HOLD_CHECK_PIPELINE_NAME);
    expect(organizationProcessModule.eventing?.pipeline.split(", ")).toContain(
      SEAT_HOLD_CHECK_PIPELINE_NAME,
    );
    expect(definition.metadata.name).toBe(SEAT_HOLD_CHECK_PIPELINE_NAME);
    expect(definition.eventSubscribers.size).toBe(0);
    expect(process.config.schedule?.everyMs).toBe(SEAT_HOLD_CHECK_INTERVAL_MS);
  });

  describe("when it wakes", () => {
    it("asks for one check, keyed by the wake, and records when it ran", () => {
      const first = wake(NOW);
      const redelivered = wake(NOW);

      expect(first.state).toEqual({ lastCheckAt: NOW });
      expect(first.intents).toHaveLength(1);
      expect(first.intents?.[0]).toMatchObject({
        intentType: "check",
        payload: { scheduledFor: NOW },
      });
      expect(first.intents?.[0]?.messageKey).toBe(redelivered.intents?.[0]?.messageKey);
      expect(wake(NOW + SEAT_HOLD_CHECK_INTERVAL_MS).intents?.[0]?.messageKey).not.toBe(
        first.intents?.[0]?.messageKey,
      );
    });
  });

  describe("when the check intent runs", () => {
    it("runs the check and prunes its outbox rows older than a week", async () => {
      const { deps, process } = built({
        check: vi.fn(async () => ({ admitted: 2, failures: [] })),
      });

      await deliver(process, NOW);

      expect(deps.check).toHaveBeenCalledTimes(1);
      expect(deps.deleteDispatchedBefore).toHaveBeenCalledWith({
        processName: SEAT_HOLD_CHECK_PROCESS_NAME,
        before: NOW - WEEK_MS,
      });
    });

    it("settles when an organization failed, leaving it for the next check", async () => {
      const { deps, process } = built({
        check: vi.fn(async () => ({
          admitted: 1,
          failures: [{ organizationId: "org_acme", error: "database unavailable" }],
        })),
      });

      await expect(deliver(process, NOW)).resolves.toBeUndefined();
      expect(deps.deleteDispatchedBefore).toHaveBeenCalledTimes(1);
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
