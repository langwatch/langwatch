/**
 * The background step applying goose 00128's TTL to existing billable_events parts.
 * @see ../../../../specs/billable-events-retention-step.feature
 */
import { describe, expect, it } from "vitest";

import { MemoryBillableEventsTtlRepository } from "../../repositories/memory/memory.billable-events-ttl.repository.ts";
import { BillableEventsTtlService, type TtlProgress } from "../billable-events-ttl.service.ts";

function serviceOver(mutations: MemoryBillableEventsTtlRepository) {
  return BillableEventsTtlService.create({ mutations, pollIntervalMs: 0 });
}

describe("BillableEventsTtlService.materialise", () => {
  describe("given no TTL materialisation is listed", () => {
    /** @scenario "The step starts the TTL materialisation once and waits for it to finish" */
    it("saves before starting one materialisation, then reports done once it finishes", async () => {
      const mutations = MemoryBillableEventsTtlRepository.create();
      const saved: TtlProgress[] = [];

      const progress = await serviceOver(mutations).materialise({
        dryRun: false,
        resumed: null,
        signal: new AbortController().signal,
        onPoll: async (report) => {
          saved.push(report);
          // ClickHouse finishes the materialisation while the step waits on it.
          if (saved.length === 2) {
            mutations.record({
              mutationId: "mutation_ttl_1.txt",
              isDone: true,
              partsToDo: 0,
              latestFailReason: "",
            });
          }
        },
      });

      expect(mutations.started()).toBe(1);
      expect(saved[0]).toEqual({ mutationId: null, partsToDo: 0, started: true });
      expect(progress).toEqual({ mutationId: "mutation_ttl_1.txt", partsToDo: 0, started: true });
    });

    /** @scenario "A dry run starts nothing" */
    it("starts nothing and saves nothing on a dry run", async () => {
      const mutations = MemoryBillableEventsTtlRepository.create();
      const saved: TtlProgress[] = [];

      await serviceOver(mutations).materialise({
        dryRun: true,
        resumed: null,
        signal: new AbortController().signal,
        onPoll: async (report) => void saved.push(report),
      });

      expect(mutations.started()).toBe(0);
      expect(saved).toEqual([]);
    });
  });

  describe("given an earlier run started the materialisation and none is listed any more", () => {
    /** @scenario "A resumed step never starts a second materialisation" */
    it("reports done without starting another", async () => {
      const mutations = MemoryBillableEventsTtlRepository.create();

      const progress = await serviceOver(mutations).materialise({
        dryRun: false,
        resumed: { mutationId: null, partsToDo: 0, started: true },
        signal: new AbortController().signal,
        onPoll: async () => {},
      });

      expect(mutations.started()).toBe(0);
      expect(progress.started).toBe(true);
    });
  });

  describe("given ClickHouse lists the materialisation as failed", () => {
    /** @scenario "A failed materialisation fails the step with its reason" */
    it("fails the step naming the mutation and the reason", async () => {
      const mutations = MemoryBillableEventsTtlRepository.create();
      mutations.record({
        mutationId: "mutation_7.txt",
        isDone: false,
        partsToDo: 3,
        latestFailReason: "Memory limit exceeded",
      });

      await expect(
        serviceOver(mutations).materialise({
          dryRun: false,
          resumed: null,
          signal: new AbortController().signal,
          onPoll: async () => {},
        }),
      ).rejects.toThrow(/mutation_7\.txt.*Memory limit exceeded/);
      expect(mutations.started()).toBe(0);
    });
  });
});
