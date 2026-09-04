import { describe, expect, it, vi } from "vitest";
import type { TriggerSummary } from "@langwatch/automation-contract";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import { TriggerSettlementPersistenceService } from "../trigger-settlement-persistence.service";

const trigger: TriggerSummary = {
  id: "trigger-1",
  projectId: "project-1",
  name: "Every trace",
  action: "ADD_TO_DATASET",
  triggerKind: "AUTOMATION",
  actionParams: {},
  filters: {},
  filterQuery: null,
  alertType: null,
  message: null,
  customGraphId: null,
  notificationCadence: "immediately",
  traceDebounceMs: 0,
  templates: {},
} as never;

const fold: TraceSummaryData = {
  traceId: "trace-1",
} as never;

function runtime(overrides: {
  confirms?: boolean;
  capDecision?: { allowed: boolean; count: number; cap: number; skipped: number };
  breachThrows?: Error;
} = {}) {
  const consumePersistCapSlot = vi.fn().mockResolvedValue(
    overrides.capDecision ?? { allowed: true, count: 1, cap: 100, skipped: 0 },
  );
  const handlePersistCapBreach = overrides.breachThrows
    ? vi.fn().mockRejectedValue(overrides.breachThrows)
    : vi.fn().mockResolvedValue(undefined);
  const dispatch = vi.fn().mockResolvedValue(undefined);
  const capture = vi.fn();

  const automation = {
    getActiveTraceTriggersForProject: vi.fn().mockResolvedValue([trigger]),
    filterSendClaimed: vi.fn().mockResolvedValue(new Set<string>()),
    resolvePersistDailyCap: vi.fn().mockResolvedValue(100),
    consumePersistCapSlot,
    handlePersistCapBreach,
    claimSend: vi.fn().mockResolvedValue(true),
  } as never;

  const service = TriggerSettlementPersistenceService.create({
    automation,
    projects: {
      tryGetById: vi.fn().mockResolvedValue({ id: "project-1", name: "Project", slug: "project" }),
    } as never,
    traces: { tryGetSummary: vi.fn().mockResolvedValue(fold) } as never,
    confirmation: { confirms: vi.fn().mockResolvedValue(overrides.confirms ?? true) } as never,
    persistActions: { dispatch } as never,
    clock: { now: () => new Date("2026-01-01T00:00:00Z") } as never,
    observability: { recordOverflow: vi.fn(), capture } as never,
  });

  return { service, consumePersistCapSlot, dispatch, handlePersistCapBreach, capture };
}

describe("given a settled match at persist dispatch", () => {
  describe("when its filters still pass at dispatch time", () => {
    /** @scenario "A confirmed persist dispatch consumes a ceiling slot" */
    it("consumes one slot of the trigger's daily ceiling", async () => {
      const { service, consumePersistCapSlot, dispatch } = runtime({ confirms: true });

      await service.dispatch({ projectId: "project-1", triggerId: "trigger-1", traceIds: ["trace-1"] });

      expect(consumePersistCapSlot).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledTimes(1);
    });
  });

  describe("when its filters no longer pass at dispatch time", () => {
    /** @scenario "A match that fails its filters at dispatch consumes nothing" */
    it("consumes no ceiling slot and dispatches no action", async () => {
      const { service, consumePersistCapSlot, dispatch } = runtime({ confirms: false });

      await service.dispatch({ projectId: "project-1", triggerId: "trigger-1", traceIds: ["trace-1"] });

      expect(consumePersistCapSlot).not.toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();
    });
  });

  describe("when the trigger has reached its daily ceiling", () => {
    /** @scenario "A dispatch over the ceiling is dropped without an error" */
    it("dispatches nothing for it and completes rather than retrying", async () => {
      const { service, dispatch } = runtime({
        confirms: true,
        capDecision: { allowed: false, count: 101, cap: 100, skipped: 1 },
      });

      await expect(
        service.dispatch({ projectId: "project-1", triggerId: "trigger-1", traceIds: ["trace-1"] }),
      ).resolves.toBeUndefined();
      expect(dispatch).not.toHaveBeenCalled();
    });
  });

  describe("when the containment path fails while handling a breach", () => {
    /** @scenario "A containment failure never breaks the dispatch it was watching" */
    it("does not retry the persist dispatch because of the containment failure", async () => {
      const { service, capture } = runtime({
        confirms: true,
        capDecision: { allowed: false, count: 101, cap: 100, skipped: 1 },
        breachThrows: new Error("mailer down"),
      });

      await expect(
        service.dispatch({ projectId: "project-1", triggerId: "trigger-1", traceIds: ["trace-1"] }),
      ).resolves.toBeUndefined();
      expect(capture).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ phase: "persist-cap-breach" }),
      );
    });
  });
});
