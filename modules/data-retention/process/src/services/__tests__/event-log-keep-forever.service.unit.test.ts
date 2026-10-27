/**
 * @see modules/data-retention/specs/event-log-retention-via-eventing.feature
 */
import { describe, expect, it } from "vitest";

import { MemoryRetroactiveRetentionRepository } from "../../repositories/memory/memory.retroactive-retention.repository.ts";
import type { KeepForeverRewrite } from "../../repositories/retroactive-retention.repository.ts";
import {
  EventLogKeepForeverService,
  type KeepForeverProgress,
} from "../event-log-keep-forever.service.ts";

function harness({ privateOrganizations = [] }: { privateOrganizations?: string[] } = {}) {
  const retroactive = MemoryRetroactiveRetentionRepository.create();
  retroactive.privateOrganizations = privateOrganizations;
  const saved: KeepForeverProgress[] = [];
  const service = EventLogKeepForeverService.create({ retroactive, pollIntervalMs: 0 });
  const run = ({
    dryRun = false,
    done = [],
    signal = new AbortController().signal,
  }: { dryRun?: boolean; done?: string[]; signal?: AbortSignal } = {}) =>
    service.keepIndefiniteEventsForever({
      dryRun,
      signal,
      done,
      onTargetDone: async (progress) => void saved.push({ ...progress, done: [...progress.done] }),
    });
  return { retroactive, saved, run };
}

/** A target whose rewrite ClickHouse reports as failed. */
const failing: KeepForeverRewrite = {
  mutationId: "mutation_9.txt",
  isDone: false,
  partsToDo: 4,
  latestFailReason: "disk full",
};

describe("EventLogKeepForeverService", () => {
  describe("when the step runs", () => {
    /** @scenario "Event-log rows stamped before the ruling are re-stamped to be kept forever" */
    it("re-stamps the shared target and each private dataplane once, saving after each", async () => {
      const { retroactive, saved, run } = harness({ privateOrganizations: ["org-private"] });

      const report = await run();

      expect(report.done).toEqual(["shared", "org-private"]);
      expect(saved.map((progress) => progress.done)).toEqual([
        ["shared"],
        ["shared", "org-private"],
      ]);
      expect(await retroactive.findKeepForeverRewrites({})).toHaveLength(1);
      expect(
        await retroactive.findKeepForeverRewrites({ organizationId: "org-private" }),
      ).toHaveLength(1);
    });

    /** @scenario "Event-log rows stamped before the ruling are re-stamped to be kept forever" */
    it("resumes from its checkpoint without rewriting a finished target again", async () => {
      const { retroactive, run } = harness({ privateOrganizations: ["org-private"] });

      await run({ done: ["shared"] });

      expect(await retroactive.findKeepForeverRewrites({})).toEqual([]);
      expect(
        await retroactive.findKeepForeverRewrites({ organizationId: "org-private" }),
      ).toHaveLength(1);
    });
  });

  describe("when the step runs a second time with no checkpoint", () => {
    it("starts no rewrite on a target a finished rewrite already holds", async () => {
      const { retroactive, run } = harness({ privateOrganizations: ["org-private"] });
      await run();

      const second = await run();

      expect(second.done).toEqual(["shared", "org-private"]);
      expect(await retroactive.findKeepForeverRewrites({})).toHaveLength(1);
      expect(
        await retroactive.findKeepForeverRewrites({ organizationId: "org-private" }),
      ).toHaveLength(1);
    });
  });

  describe("when the step is a dry run", () => {
    it("lists the targets it would rewrite and rewrites nothing", async () => {
      const { retroactive, saved, run } = harness();

      const report = await run({ dryRun: true });

      expect(report).toEqual({ done: [], wouldStart: ["shared"] });
      expect(saved).toEqual([]);
      expect(await retroactive.findKeepForeverRewrites({})).toEqual([]);
    });
  });

  describe("when ClickHouse reports the rewrite failed", () => {
    it("fails the step naming the target and the reason", async () => {
      const service = EventLogKeepForeverService.create({
        retroactive: Object.assign(MemoryRetroactiveRetentionRepository.create(), {
          findKeepForeverRewrites: async () => [failing],
        }),
        pollIntervalMs: 0,
      });

      await expect(
        service.keepIndefiniteEventsForever({
          dryRun: false,
          signal: new AbortController().signal,
          done: [],
          onTargetDone: async () => {},
        }),
      ).rejects.toThrow(/shared target .*disk full/);
    });
  });
});
