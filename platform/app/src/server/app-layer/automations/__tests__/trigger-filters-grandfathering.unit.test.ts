import { TriggerAction, type Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PrismaTriggerRepository } from "../repositories/trigger.prisma.repository";

/**
 * A stale `evaluations.state` value: a phantom left by a removed ES index,
 * never a value any evaluation run reports (#4805, #6296). Grandfathering
 * exists precisely so a row already holding this can still be saved.
 */
const STALE_STATE_FILTERS = {
  "evaluations.state": { e1: ["Error_Message"] },
};

function makeRepo({
  storedFilters,
}: {
  /** What `prisma.trigger.findUnique` resolves for the row's `filters`
   *  column. Omit to simulate no row found (`findUnique` resolves `null`). */
  storedFilters?: unknown;
} = {}) {
  const create = vi.fn().mockResolvedValue({});
  const update = vi.fn().mockResolvedValue({});
  const findUnique = vi
    .fn()
    .mockResolvedValue(
      storedFilters === undefined ? null : { filters: storedFilters },
    );
  const prisma = {
    trigger: { create, update, findUnique },
  } as unknown as PrismaClient;

  return {
    repo: new PrismaTriggerRepository(prisma),
    create,
    update,
    findUnique,
  };
}

describe("PrismaTriggerRepository", () => {
  describe("update", () => {
    describe("given a row whose stored filters already hold a non-canonical evaluations.state value", () => {
      describe("when the payload carries that same value through unchanged, with only the name changed", () => {
        it("succeeds and preserves the stale value byte-for-byte in the write", async () => {
          const { repo, update, findUnique } = makeRepo({
            storedFilters: STALE_STATE_FILTERS,
          });

          await repo.update({
            triggerId: "trigger_1",
            projectId: "project_1",
            data: {
              name: "Renamed automation",
              filters: JSON.stringify(STALE_STATE_FILTERS),
            },
          });

          // Scoped to the exact row (multitenancy) before the write proceeds.
          expect(findUnique).toHaveBeenCalledWith({
            where: { id: "trigger_1", projectId: "project_1" },
            select: { filters: true },
          });

          expect(update).toHaveBeenCalledTimes(1);
          const written = update.mock.calls[0]![0].data.filters;
          expect(written).toContain("Error_Message");
          expect(JSON.parse(written)).toEqual(STALE_STATE_FILTERS);
        });
      });

      describe("when the payload changes only notificationCadence", () => {
        it("succeeds", async () => {
          const { repo, update } = makeRepo({
            storedFilters: STALE_STATE_FILTERS,
          });

          await repo.update({
            triggerId: "trigger_1",
            projectId: "project_1",
            data: {
              notificationCadence: "hourly_digest",
              filters: JSON.stringify(STALE_STATE_FILTERS),
            },
          });

          expect(update).toHaveBeenCalledTimes(1);
        });
      });

      describe("when the payload adds a second, different non-canonical value", () => {
        it("rejects the update, naming only the newly-introduced value", async () => {
          const { repo, update } = makeRepo({
            storedFilters: STALE_STATE_FILTERS,
          });

          await expect(
            repo.update({
              triggerId: "trigger_1",
              projectId: "project_1",
              data: {
                filters: JSON.stringify({
                  "evaluations.state": {
                    e1: ["Error_Message"],
                    e2: ["Weird_Legacy"],
                  },
                }),
              },
            }),
          ).rejects.toMatchObject({
            code: "invalid_evaluation_state_filter",
            meta: expect.objectContaining({
              evaluatorKey: "e2",
              offendingValue: "Weird_Legacy",
            }),
          });
          expect(update).not.toHaveBeenCalled();
        });
      });

      describe("when the payload replaces the stale value with a canonical value", () => {
        it("succeeds without re-reading the row", async () => {
          const { repo, update, findUnique } = makeRepo({
            storedFilters: STALE_STATE_FILTERS,
          });

          await repo.update({
            triggerId: "trigger_1",
            projectId: "project_1",
            data: {
              filters: JSON.stringify({
                "evaluations.state": { e1: ["error"] },
              }),
            },
          });

          expect(update).toHaveBeenCalledTimes(1);
          // No offending value in the incoming payload, so the guard never
          // needs to know what the row already held.
          expect(findUnique).not.toHaveBeenCalled();
        });
      });
    });

    describe("given a row with no stored non-canonical evaluations.state value", () => {
      describe("when the payload introduces one", () => {
        it("rejects the update", async () => {
          const { repo, update } = makeRepo({ storedFilters: {} });

          await expect(
            repo.update({
              triggerId: "trigger_1",
              projectId: "project_1",
              data: { filters: JSON.stringify(STALE_STATE_FILTERS) },
            }),
          ).rejects.toMatchObject({
            code: "invalid_evaluation_state_filter",
            meta: expect.objectContaining({
              evaluatorKey: "e1",
              offendingValue: "Error_Message",
            }),
          });
          expect(update).not.toHaveBeenCalled();
        });
      });
    });

    describe("given the two encodings a stored row's filters can be in", () => {
      describe("when the stored filters are a JSON string", () => {
        it("still grandfathers the stale value through", async () => {
          const { repo, update } = makeRepo({
            storedFilters: JSON.stringify(STALE_STATE_FILTERS),
          });

          await repo.update({
            triggerId: "trigger_1",
            projectId: "project_1",
            data: { filters: JSON.stringify(STALE_STATE_FILTERS) },
          });

          expect(update).toHaveBeenCalledTimes(1);
        });
      });

      describe("when the stored filters are a raw object", () => {
        it("still grandfathers the stale value through", async () => {
          const { repo, update } = makeRepo({
            storedFilters: STALE_STATE_FILTERS,
          });

          await repo.update({
            triggerId: "trigger_1",
            projectId: "project_1",
            data: { filters: STALE_STATE_FILTERS as Prisma.InputJsonValue },
          });

          expect(update).toHaveBeenCalledTimes(1);
        });
      });
    });
  });

  describe("create", () => {
    describe("given a payload with a non-canonical evaluations.state value", () => {
      describe("when creating a brand-new trigger", () => {
        it("rejects unconditionally, matching create's unchanged behaviour", async () => {
          const { repo, create } = makeRepo();

          await expect(
            repo.create({
              data: {
                name: "New automation",
                projectId: "project_1",
                action: TriggerAction.SEND_SLACK_MESSAGE,
                actionParams: {},
                filters: JSON.stringify(STALE_STATE_FILTERS),
              },
            }),
          ).rejects.toMatchObject({
            code: "invalid_evaluation_state_filter",
            meta: expect.objectContaining({
              evaluatorKey: "e1",
              offendingValue: "Error_Message",
            }),
          });
          expect(create).not.toHaveBeenCalled();
        });
      });
    });
  });
});
