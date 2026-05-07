/**
 * @vitest-environment node
 *
 * Unit tests for ArchiveSetCommand + SimulationSetArchivedEvent (lw#3636).
 *
 * Covers schema parsing, command handler emit, idempotency-key
 * collapsing, and the corresponding type guard.
 *
 * @see specs/event-sourcing/simulation-set-archive.feature
 */

import { describe, expect, it } from "vitest";
import { ArchiveSetCommand } from "../commands";
import type { TenantId } from "../../../domain/tenantId";
import {
  simulationSetArchivedEventDataSchema,
  type SimulationProcessingEvent,
} from "../schemas/events";
import { isSimulationSetArchivedEvent } from "../schemas/typeGuards";

function makeArchiveSetCommand(overrides?: {
  tenantId?: string;
  scenarioSetId?: string;
  scenarioRunIds?: string[];
  occurredAt?: number;
}) {
  const tenantId = overrides?.tenantId ?? "tenant-1";
  return {
    tenantId: tenantId as TenantId,
    aggregateId: overrides?.scenarioSetId ?? "set-1",
    type: "lw.simulation_set.archive" as const,
    data: {
      tenantId,
      occurredAt: overrides?.occurredAt ?? 1700000000000,
      scenarioSetId: overrides?.scenarioSetId ?? "set-1",
      scenarioRunIds: overrides?.scenarioRunIds ?? [
        "run-1",
        "run-2",
        "run-3",
      ],
    },
  };
}

describe("ArchiveSetCommand (lw#3636)", () => {
  describe("given a tenant archives a set with three runs", () => {
    describe("when the ArchiveSetCommand handler runs", () => {
      /** @scenario ArchiveSetCommand emits a SimulationSetArchived event with the snapshotted run ids */
      it("emits a single SimulationSetArchived event carrying the runs", async () => {
        const handler = new ArchiveSetCommand();
        const events = await handler.handle(makeArchiveSetCommand());

        expect(events).toHaveLength(1);
        const [event] = events;
        expect(event!.type).toBe("lw.simulation_set.archived");
        expect(event!.aggregateType).toBe("simulation_set");
        expect(event!.aggregateId).toBe("set-1");
        expect(event!.data).toEqual({
          scenarioSetId: "set-1",
          scenarioRunIds: ["run-1", "run-2", "run-3"],
        });
      });
    });
  });

  describe("given two ArchiveSetCommand invocations for the same scenarioSetId", () => {
    describe("when idempotency keys are computed", () => {
      /** @scenario ArchiveSetCommand idempotency key collapses retries on the same set */
      it("collapses both invocations to the same idempotency key", async () => {
        const handler = new ArchiveSetCommand();
        const a = await handler.handle(makeArchiveSetCommand({ occurredAt: 1 }));
        const b = await handler.handle(
          makeArchiveSetCommand({
            occurredAt: 2,
            scenarioRunIds: ["run-1", "run-2", "run-3", "run-4"],
          }),
        );

        expect(a[0]!.idempotencyKey).toBe(b[0]!.idempotencyKey);
        expect(a[0]!.idempotencyKey).toBe("tenant-1:set-1:archiveSet");
      });
    });
  });

  describe("given a SimulationProcessingEvent of type lw.simulation_set.archived", () => {
    describe("when the type guard runs", () => {
      /** @scenario isSimulationSetArchivedEvent narrows the event type */
      it("returns true and narrows to SimulationSetArchivedEvent", async () => {
        const handler = new ArchiveSetCommand();
        const [event] = await handler.handle(makeArchiveSetCommand());
        const candidate = event as unknown as SimulationProcessingEvent;
        expect(isSimulationSetArchivedEvent(candidate)).toBe(true);
        if (isSimulationSetArchivedEvent(candidate)) {
          // Type narrowing — these reads compile only when the guard works.
          expect(candidate.data.scenarioSetId).toBe("set-1");
          expect(candidate.data.scenarioRunIds).toHaveLength(3);
        }
      });
    });
  });

  describe("given a candidate event missing the scenarioRunIds field", () => {
    describe("when SimulationSetArchivedEventSchema.safeParse runs", () => {
      /** @scenario SimulationSetArchivedEvent rejects payloads missing scenarioRunIds */
      it("rejects the payload", () => {
        const result = simulationSetArchivedEventDataSchema.safeParse({
          scenarioSetId: "set-1",
        });
        expect(result.success).toBe(false);
      });
    });
  });

  describe("given a candidate event with an empty scenarioRunIds array", () => {
    describe("when SimulationSetArchivedEventSchema.safeParse runs", () => {
      it("rejects the payload (empty archive is a no-op masquerading as a valid event)", () => {
        const result = simulationSetArchivedEventDataSchema.safeParse({
          scenarioSetId: "set-1",
          scenarioRunIds: [],
        });
        expect(result.success).toBe(false);
      });
    });
  });
});
