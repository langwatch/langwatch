import {
  FAILED_RETROACTIVE_APPLY_PREFIX,
  PENDING_RETROACTIVE_APPLY_PREFIX,
  RETROACTIVE_APPLY_FAILURE_MESSAGE,
  RETROACTIVE_APPLY_REQUESTED_EVENT_TYPE,
  RETROACTIVE_CANCEL_REQUESTED_EVENT_TYPE,
  RETROACTIVE_PROGRESS_RECORDED_EVENT_TYPE,
  type RetroactiveApplyRequestedData,
  type RetroactiveCancelRequestedData,
} from "@langwatch/data-retention-contract";
import { getInstance, Ksuid } from "@langwatch/ksuid";
import { describe, expect, it } from "vitest";

import { MemoryRetroactiveRetentionRepository } from "../../repositories/memory/memory.retroactive-retention.repository.ts";
import { MemoryRetroactiveStatusRepository } from "../../repositories/memory/memory.retroactive-status.repository.ts";
import type { RetroactiveFact } from "../../rules/retroactive-status.rules.ts";
import { RetroactiveRetentionService } from "../retroactive-retention.service.ts";

const PROJECT = "project-1";
const USER = "user-1";
const MAX_ATTEMPTS = 3;

type FactType = RetroactiveFact["type"];

/** The service over memory twins, each sent command folded back as the pipeline's fact would be. */
function createHarness() {
  const retroactive = MemoryRetroactiveRetentionRepository.create();
  const status = MemoryRetroactiveStatusRepository.create();
  const service = RetroactiveRetentionService.create({
    retroactive,
    status,
    applyMaxAttempts: MAX_ATTEMPTS,
  });
  const facts: RetroactiveFact[] = [];
  let second = 1_800_000_000;
  const nextId = () =>
    new Ksuid({
      environment: "test",
      resource: "event",
      timestamp: second++,
      instance: getInstance(),
      sequenceId: 0,
    }).toString();
  const record = async (fact: RetroactiveFact) => {
    facts.push(fact);
    await service.fold({ projectId: fact.data.projectId, fact });
  };
  service.connect({
    requestRetroactiveApply: {
      send: ({ tenantId: _tenantId, occurredAt, ...data }) =>
        record({ id: nextId(), occurredAt, type: RETROACTIVE_APPLY_REQUESTED_EVENT_TYPE, data }),
    },
    requestRetroactiveCancel: {
      send: ({ tenantId: _tenantId, occurredAt, ...data }) =>
        record({ id: nextId(), occurredAt, type: RETROACTIVE_CANCEL_REQUESTED_EVENT_TYPE, data }),
    },
    recordRetroactiveProgress: {
      send: ({ tenantId: _tenantId, occurredAt, ...data }) =>
        record({ id: nextId(), occurredAt, type: RETROACTIVE_PROGRESS_RECORDED_EVENT_TYPE, data }),
    },
  });

  const factsOf = (type: FactType) => facts.filter((fact) => fact.type === type);
  const applyOf = (index = 0) =>
    factsOf(RETROACTIVE_APPLY_REQUESTED_EVENT_TYPE)[index]!.data as RetroactiveApplyRequestedData;
  const cancelOf = (index = 0) =>
    factsOf(RETROACTIVE_CANCEL_REQUESTED_EVENT_TYPE)[index]!.data as RetroactiveCancelRequestedData;
  const apply = (category: "traces" | "scenarios" = "traces") =>
    service.requestApply({ projectId: PROJECT, category, retentionDays: 30, userId: USER });
  const cancel = (mutationId: string) =>
    service.requestCancel({ projectId: PROJECT, mutationId, userId: USER });
  const progress = () => service.getProgress({ projectId: PROJECT });

  return {
    service,
    retroactive,
    status,
    facts,
    factsOf,
    applyOf,
    cancelOf,
    apply,
    cancel,
    progress,
  };
}

describe("RetroactiveRetentionService", () => {
  describe("when the member applies retention to existing data", () => {
    /** @scenario "Applying to existing data answers once the request is accepted" */
    it("records the request and answers the planned tables without ClickHouse", async () => {
      const h = createHarness();

      const answer = await h.apply();

      expect(answer.tables).toEqual(h.retroactive.plannedTables({ category: "traces" }));
      expect(answer.tables.length).toBeGreaterThan(0);
      expect(h.retroactive.rewrites).toEqual([]);
      expect(h.retroactive.progressReads).toEqual([]);
      expect(h.factsOf(RETROACTIVE_APPLY_REQUESTED_EVENT_TYPE)).toHaveLength(1);
    });

    /** @scenario "An accepted apply shows as applying until the worker starts it" */
    it("answers the waiting apply as a cancellable entry", async () => {
      const h = createHarness();
      await h.apply();

      const entries = await h.progress();

      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        mutationId: `${PENDING_RETROACTIVE_APPLY_PREFIX}${h.applyOf().requestId}`,
        category: "traces",
        progressPercent: 0,
      });
    });

    /** @scenario "A second apply while one runs is refused" */
    it("refuses a second apply of the same category", async () => {
      const h = createHarness();
      await h.apply();
      await h.service.runApply(h.applyOf(), { attempt: 1 });

      await expect(h.apply()).rejects.toMatchObject({
        code: "data_retention_mutation_in_progress",
      });
      expect(h.factsOf(RETROACTIVE_APPLY_REQUESTED_EVENT_TYPE)).toHaveLength(1);
    });
  });

  describe("when the worker handles an apply", () => {
    /** @scenario "The worker starts the rewrite once and records it as the project's progress" */
    it("issues every planned rewrite and records the running mutations", async () => {
      const h = createHarness();
      await h.apply();

      await h.service.runApply(h.applyOf(), { attempt: 1 });

      const targets = h.retroactive.applyTargets({ category: "traces" });
      expect(h.retroactive.rewrites).toEqual(targets.map((target) => `${PROJECT}/${target}`));
      const entries = await h.progress();
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.every((entry) => !entry.mutationId.startsWith("pending:"))).toBe(true);
      expect(entries.every((entry) => entry.category === "traces")).toBe(true);
    });

    /** @scenario "A redelivered apply starts no second rewrite" */
    it("issues nothing when the same apply is delivered again", async () => {
      const h = createHarness();
      await h.apply();
      await h.service.runApply(h.applyOf(), { attempt: 1 });
      const issued = [...h.retroactive.rewrites];

      await h.service.runApply(h.applyOf(), { attempt: 2 });

      expect(h.retroactive.rewrites).toEqual(issued);
    });

    /** @scenario "An apply whose rewrite is already running is settled without a second rewrite" */
    it("settles as already running when a rewrite of its kind runs", async () => {
      const h = createHarness();
      await h.apply();
      await h.retroactive.triggerUpdate({
        projectId: PROJECT,
        category: "traces",
        newRetentionDays: 30,
      });
      const issued = [...h.retroactive.rewrites];

      await h.service.runApply(h.applyOf(), { attempt: 1 });

      expect(h.retroactive.rewrites).toEqual(issued);
      const entries = await h.progress();
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.every((entry) => entry.table !== "")).toBe(true);
    });

    /** @scenario "A partly applied apply redelivered issues only the rewrites not yet issued" */
    it("issues only the rewrites a crashed delivery left", async () => {
      const h = createHarness();
      await h.apply();
      const targets = h.retroactive.applyTargets({ category: "traces" });
      expect(targets.length).toBeGreaterThan(1);
      h.retroactive.refuseTarget = targets[1];

      await expect(h.service.runApply(h.applyOf(), { attempt: 1 })).rejects.toThrow("refused");
      expect(h.retroactive.rewrites).toEqual([`${PROJECT}/${targets[0]}`]);

      h.retroactive.refuseTarget = undefined;
      await h.service.runApply(h.applyOf(), { attempt: 2 });

      expect(h.retroactive.rewrites).toEqual(targets.map((target) => `${PROJECT}/${target}`));
    });
  });

  describe("when the rewrite keeps failing", () => {
    /** @scenario "A failing rewrite is retried, and its last attempt shows the failure" */
    it("keeps the apply waiting, then shows it as failed after the last attempt", async () => {
      const h = createHarness();
      await h.apply();
      h.retroactive.refuseRewrites = new Error("ClickHouse unreachable");

      await expect(h.service.runApply(h.applyOf(), { attempt: 1 })).rejects.toThrow(
        "ClickHouse unreachable",
      );
      expect((await h.progress())[0]?.mutationId).toMatch(/^pending:/);

      await expect(h.service.runApply(h.applyOf(), { attempt: MAX_ATTEMPTS })).rejects.toThrow(
        "ClickHouse unreachable",
      );
      expect(await h.progress()).toEqual([
        expect.objectContaining({
          mutationId: `${FAILED_RETROACTIVE_APPLY_PREFIX}${h.applyOf().requestId}`,
          category: "traces",
          failure: RETROACTIVE_APPLY_FAILURE_MESSAGE,
        }),
      ]);
    });

    /** @scenario "A failed apply stays on the panel until dismissed or applied again" */
    it("replaces the failure on a new apply and drops it on dismissal", async () => {
      const h = createHarness();
      h.retroactive.refuseRewrites = new Error("ClickHouse unreachable");
      await h.apply();
      await expect(h.service.runApply(h.applyOf(0), { attempt: MAX_ATTEMPTS })).rejects.toThrow(
        "ClickHouse unreachable",
      );

      await h.apply();
      expect(await h.progress()).toEqual([
        expect.objectContaining({
          mutationId: `${PENDING_RETROACTIVE_APPLY_PREFIX}${h.applyOf(1).requestId}`,
        }),
      ]);

      await expect(h.service.runApply(h.applyOf(1), { attempt: MAX_ATTEMPTS })).rejects.toThrow(
        "ClickHouse unreachable",
      );
      const failedId = `${FAILED_RETROACTIVE_APPLY_PREFIX}${h.applyOf(1).requestId}`;
      expect((await h.progress()).map((entry) => entry.mutationId)).toEqual([failedId]);
      const reads = h.retroactive.progressReads.length;

      await h.cancel(failedId);
      await h.service.runCancel(h.cancelOf());

      expect(await h.progress()).toEqual([]);
      expect(h.retroactive.progressReads).toHaveLength(reads);
    });
  });

  describe("when the member cancels", () => {
    /** @scenario "Cancelling answers once the request is accepted" */
    it("records the cancel and hides the mutation without ClickHouse", async () => {
      const h = createHarness();
      await h.apply();
      await h.service.runApply(h.applyOf(), { attempt: 1 });
      const [first] = await h.progress();
      const reads = h.retroactive.progressReads.length;

      await h.cancel(first!.mutationId);

      expect(h.retroactive.progressReads).toHaveLength(reads);
      expect(h.cancelOf().mutationId).toBe(first!.mutationId);
      expect((await h.progress()).map((entry) => entry.mutationId)).not.toContain(
        first!.mutationId,
      );
    });

    /** @scenario "The worker kills the cancelled mutation, and a redelivery is harmless" */
    it("kills the mutation and records what still runs, twice without harm", async () => {
      const h = createHarness();
      await h.apply();
      await h.service.runApply(h.applyOf(), { attempt: 1 });
      const [first] = await h.progress();
      await h.cancel(first!.mutationId);

      await h.service.runCancel(h.cancelOf());
      await h.service.runCancel(h.cancelOf());

      const running = await h.retroactive.findMutationProgress({ projectId: PROJECT });
      expect(running.map((mutation) => mutation.mutationId)).not.toContain(first!.mutationId);
      expect((await h.progress()).map((entry) => entry.mutationId)).toEqual(
        running.map((mutation) => mutation.mutationId),
      );
    });

    /** @scenario "Cancelling an apply the worker has not started stops it starting" */
    it("starts nothing for an apply cancelled before the worker ran it", async () => {
      const h = createHarness();
      await h.apply();
      await h.cancel(`${PENDING_RETROACTIVE_APPLY_PREFIX}${h.applyOf().requestId}`);

      await h.service.runCancel(h.cancelOf());
      await h.service.runApply(h.applyOf(), { attempt: 1 });

      expect(h.retroactive.rewrites).toEqual([]);
      expect(await h.progress()).toEqual([]);
    });
  });

  describe("when progress is read or refreshed", () => {
    /** @scenario "The progress read answers the worker's status, never system.mutations" */
    it("answers the recorded mutations without reading ClickHouse", async () => {
      const h = createHarness();
      await h.apply();
      await h.service.runApply(h.applyOf(), { attempt: 1 });
      const reads = h.retroactive.progressReads.length;

      const entries = await h.progress();

      expect(entries.length).toBeGreaterThan(0);
      expect(h.retroactive.progressReads).toHaveLength(reads);
    });

    /** @scenario "A progress refresh records the project only when its rewrites moved" */
    it("records nothing for an unchanged read and drops a finished rewrite", async () => {
      const h = createHarness();
      await h.apply();
      await h.service.runApply(h.applyOf(), { attempt: 1 });
      const recorded = h.factsOf(RETROACTIVE_PROGRESS_RECORDED_EVENT_TYPE).length;

      await h.service.refreshProgress({ projectId: PROJECT });
      expect(h.factsOf(RETROACTIVE_PROGRESS_RECORDED_EVENT_TYPE)).toHaveLength(recorded);

      for (const entry of await h.progress()) {
        h.retroactive.finishMutation({ projectId: PROJECT, mutationId: entry.mutationId });
      }
      await h.service.refreshProgress({ projectId: PROJECT });

      expect(h.factsOf(RETROACTIVE_PROGRESS_RECORDED_EVENT_TYPE)).toHaveLength(recorded + 1);
      expect(await h.progress()).toEqual([]);
    });

    /** @scenario "The progress read answers the share of parts rewritten" */
    it("answers parts done over the parts the rewrite started with", async () => {
      const h = createHarness();
      h.retroactive.partsPerRewrite = 4;
      await h.apply();
      await h.service.runApply(h.applyOf(), { attempt: 1 });
      const [first] = await h.progress();
      expect(first?.progressPercent).toBe(0);

      h.retroactive.setPartsToDo({
        projectId: PROJECT,
        mutationId: first!.mutationId,
        partsToDo: 1,
      });
      await h.service.refreshProgress({ projectId: PROJECT });
      await h.apply("scenarios");

      const entries = await h.progress();
      expect(entries.find((entry) => entry.mutationId === first!.mutationId)).toMatchObject({
        progressPercent: 75,
      });
      expect(entries.find((entry) => entry.category === "scenarios")).toMatchObject({
        progressPercent: 0,
      });
    });

    /** @scenario "A redelivered fact never rewinds the progress status" */
    it("ignores an older fact delivered again", async () => {
      const h = createHarness();
      await h.apply();
      await h.service.runApply(h.applyOf(), { attempt: 1 });
      const before = await h.status.getForProject({ projectId: PROJECT });
      const [olderApply] = h.factsOf(RETROACTIVE_APPLY_REQUESTED_EVENT_TYPE);

      await h.service.fold({ projectId: PROJECT, fact: olderApply! });

      expect(await h.status.getForProject({ projectId: PROJECT })).toEqual(before);
    });
  });
});
