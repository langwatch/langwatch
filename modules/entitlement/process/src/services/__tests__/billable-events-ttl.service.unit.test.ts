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

function run({
  mutations,
  resumed = null,
  dryRun = false,
  onPoll = async () => {},
}: {
  mutations: MemoryBillableEventsTtlRepository;
  resumed?: TtlProgress | null;
  dryRun?: boolean;
  onPoll?: (progress: TtlProgress) => Promise<void>;
}): Promise<TtlProgress> {
  return serviceOver(mutations).materialise({
    dryRun,
    resumed,
    signal: new AbortController().signal,
    onPoll,
  });
}

describe("BillableEventsTtlService.materialise", () => {
  describe("given no TTL materialisation is listed", () => {
    /** @scenario "The step starts the TTL materialisation once and waits for it to finish" */
    it("saves before starting one materialisation, then reports done once it finishes", async () => {
      const mutations = MemoryBillableEventsTtlRepository.create();
      const saved: TtlProgress[] = [];

      const progress = await run({
        mutations,
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
      expect(saved[0]).toEqual({ mutationId: null, partsToDo: 0, started: true, confirmed: false });
      expect(saved[1]).toEqual({ mutationId: null, partsToDo: 0, started: true, confirmed: true });
      expect(progress).toEqual({
        mutationId: "mutation_ttl_1.txt",
        partsToDo: 0,
        started: true,
        confirmed: true,
      });
    });

    /** @scenario "A dry run starts nothing" */
    it("starts nothing and saves nothing on a dry run", async () => {
      const mutations = MemoryBillableEventsTtlRepository.create();
      const saved: TtlProgress[] = [];

      await run({ mutations, dryRun: true, onPoll: async (report) => void saved.push(report) });

      expect(mutations.started()).toBe(0);
      expect(saved).toEqual([]);
    });
  });

  describe("given an earlier run confirmed the materialisation and none is listed any more", () => {
    /** @scenario "A resumed step never starts a second materialisation" */
    it("reports done with no parts left, without starting another", async () => {
      const mutations = MemoryBillableEventsTtlRepository.create();

      const progress = await run({
        mutations,
        resumed: { mutationId: "mutation_ttl_1.txt", partsToDo: 4, started: true, confirmed: true },
      });

      expect(mutations.started()).toBe(0);
      expect(progress).toEqual({
        mutationId: "mutation_ttl_1.txt",
        partsToDo: 0,
        started: true,
        confirmed: true,
      });
    });
  });

  describe("given the start threw before ClickHouse accepted it", () => {
    /** @scenario "A step stopped around the start issues the materialisation again" */
    it("leaves an unconfirmed checkpoint, and the retry starts the materialisation", async () => {
      const mutations = MemoryBillableEventsTtlRepository.create();
      const dropped = new Error("socket hang up");
      mutations.failNextStart(dropped);
      const saved: TtlProgress[] = [];

      await expect(
        run({ mutations, onPoll: async (report) => void saved.push(report) }),
      ).rejects.toBe(dropped);
      expect(saved.at(-1)).toEqual({
        mutationId: null,
        partsToDo: 0,
        started: true,
        confirmed: false,
      });

      const progress = await run({
        mutations,
        resumed: saved.at(-1) ?? null,
        onPoll: async (report) => {
          if (report.confirmed) mutations.prune();
        },
      });

      expect(mutations.started()).toBe(1);
      expect(progress.confirmed).toBe(true);
    });
  });

  describe("given an operator already started a materialisation that is still running", () => {
    /** @scenario "A materialisation the step finds running counts as started" */
    it("saves it as confirmed before waiting, so an empty list later ends the step", async () => {
      const mutations = MemoryBillableEventsTtlRepository.create();
      mutations.record({
        mutationId: "mutation_9.txt",
        isDone: false,
        partsToDo: 2,
        latestFailReason: "",
      });
      const saved: TtlProgress[] = [];

      const progress = await run({
        mutations,
        onPoll: async (report) => {
          saved.push(report);
          // ClickHouse finishes and prunes it before the next poll.
          mutations.prune();
        },
      });

      expect(saved[0]).toEqual({
        mutationId: "mutation_9.txt",
        partsToDo: 2,
        started: false,
        confirmed: true,
      });
      expect(mutations.started()).toBe(0);
      expect(progress.partsToDo).toBe(0);
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

      await expect(run({ mutations })).rejects.toMatchObject({
        code: "billable_events_ttl_failed",
      });
      expect(mutations.started()).toBe(0);
    });
  });
});
