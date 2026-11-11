// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/project-usage.feature
 */
import { describe, expect, it, vi } from "vitest";

import { MemoryNurturingUncopiedProjectRepository } from "../../repositories/memory/memory.nurturing-uncopied-project.repository.ts";
import type { NurturingUncopiedProjectRepository } from "../../repositories/nurturing-uncopied-project.repository.ts";
import { UNCOPIED_PROJECT_RETRY_WINDOW_MS } from "../../rules/nurturing-project-usage.rules.ts";
import { NurturingUncopiedProjectsService } from "../nurturing-uncopied-projects.service.ts";

const FIRST_SEEN = Date.UTC(2026, 10, 11, 12);

/** A clock the test moves by hand. */
function fakeClock() {
  let now = FIRST_SEEN;
  return {
    nowMs: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

/** One worker's service over a repository it may share with other workers. */
function workerOver({
  uncopiedProjects,
  clock,
  maxEntries,
}: Readonly<{
  uncopiedProjects: NurturingUncopiedProjectRepository;
  clock: ReturnType<typeof fakeClock>;
  maxEntries?: number;
}>) {
  return NurturingUncopiedProjectsService.create({ uncopiedProjects, clock, maxEntries });
}

describe("given a project nurturing has no placement copy of", () => {
  describe("when its traces keep arriving inside the window from when it was first seen", () => {
    /** @scenario "A new project whose copy lands within the retry window is counted" */
    it("retries them until the window has passed", async () => {
      const clock = fakeClock();
      const worker = workerOver({
        uncopiedProjects: MemoryNurturingUncopiedProjectRepository.create(),
        clock,
      });

      await expect(worker.outcomeOf({ projectId: "a" })).resolves.toBe("retry");
      clock.advance(UNCOPIED_PROJECT_RETRY_WINDOW_MS - 1);
      await expect(worker.outcomeOf({ projectId: "a" })).resolves.toBe("retry");
      clock.advance(1);
      await expect(worker.outcomeOf({ projectId: "a" })).resolves.toBe("drop");
      expect(worker.isDropped({ projectId: "a" })).toBe(true);
    });
  });

  describe("when the process restarts after the window passed", () => {
    /** @scenario "The retry window is real time from first seen, shared by every worker and kept across a restart" */
    it("drops at once from the stored first-seen time, with no new window", async () => {
      const clock = fakeClock();
      const uncopiedProjects = MemoryNurturingUncopiedProjectRepository.create();
      await workerOver({ uncopiedProjects, clock }).outcomeOf({ projectId: "a" });
      clock.advance(UNCOPIED_PROJECT_RETRY_WINDOW_MS);

      const restarted = workerOver({ uncopiedProjects, clock });

      expect(restarted.isDropped({ projectId: "a" })).toBe(false);
      await expect(restarted.outcomeOf({ projectId: "a" })).resolves.toBe("drop");
    });
  });

  describe("when two workers share the repository", () => {
    /** @scenario "The retry window is real time from first seen, shared by every worker and kept across a restart" */
    it("drops at once on the second worker after the first saw the window pass", async () => {
      const clock = fakeClock();
      const uncopiedProjects = MemoryNurturingUncopiedProjectRepository.create();
      const first = workerOver({ uncopiedProjects, clock });
      const second = workerOver({ uncopiedProjects, clock });

      await expect(first.outcomeOf({ projectId: "a" })).resolves.toBe("retry");
      clock.advance(UNCOPIED_PROJECT_RETRY_WINDOW_MS);
      await expect(first.outcomeOf({ projectId: "a" })).resolves.toBe("drop");

      await expect(second.outcomeOf({ projectId: "a" })).resolves.toBe("drop");
    });
  });

  describe("when a dropped project's batch comes again", () => {
    /** @scenario "A project with no copy after the retries is dropped, and its later batches at once" */
    it("answers from the dropped set with no repository read", async () => {
      const clock = fakeClock();
      const stored = MemoryNurturingUncopiedProjectRepository.create();
      const uncopiedProjects = {
        firstSeenAt: vi.fn(stored.firstSeenAt.bind(stored)),
        forget: vi.fn(stored.forget.bind(stored)),
      };
      const worker = workerOver({ uncopiedProjects, clock });
      await worker.outcomeOf({ projectId: "a" });
      clock.advance(UNCOPIED_PROJECT_RETRY_WINDOW_MS);
      await worker.outcomeOf({ projectId: "a" });
      uncopiedProjects.firstSeenAt.mockClear();

      expect(worker.isDropped({ projectId: "a" })).toBe(true);
      expect(uncopiedProjects.firstSeenAt).not.toHaveBeenCalled();
    });
  });

  describe("when its copy lands", () => {
    /** @scenario "A project with no copy after the retries is dropped, and its later batches at once" */
    it("deletes its first-seen row and its dropped mark", async () => {
      const clock = fakeClock();
      const uncopiedProjects = MemoryNurturingUncopiedProjectRepository.create();
      const worker = workerOver({ uncopiedProjects, clock });
      await worker.outcomeOf({ projectId: "a" });
      clock.advance(UNCOPIED_PROJECT_RETRY_WINDOW_MS);
      await worker.outcomeOf({ projectId: "a" });

      await worker.copyLanded({ projectId: "a" });

      expect(uncopiedProjects.storedProjectIds()).toEqual([]);
      expect(worker.isDropped({ projectId: "a" })).toBe(false);
    });
  });

  describe("when more projects are dropped than the cap allows", () => {
    it("evicts the least recently used one and keeps a recently hit one", async () => {
      const clock = fakeClock();
      const worker = workerOver({
        uncopiedProjects: MemoryNurturingUncopiedProjectRepository.create(),
        clock,
        maxEntries: 2,
      });
      for (const projectId of ["a", "b", "c"]) await worker.outcomeOf({ projectId });
      clock.advance(UNCOPIED_PROJECT_RETRY_WINDOW_MS);

      await worker.outcomeOf({ projectId: "a" });
      await worker.outcomeOf({ projectId: "b" });
      worker.isDropped({ projectId: "a" });
      await worker.outcomeOf({ projectId: "c" });

      expect(worker.isDropped({ projectId: "a" })).toBe(true);
      expect(worker.isDropped({ projectId: "c" })).toBe(true);
      expect(worker.isDropped({ projectId: "b" })).toBe(false);
    });
  });
});
