/**
 * The inline Sessions-destination stamp on the fold store's commit seam:
 * one throttled, error-swallowing project touch per window.
 *
 * @see specs/coding-agent/project-menu-links.feature
 */
import { describe, expect, it, vi } from "vitest";

import {
  CODING_AGENT_SESSION_SEEN_WINDOW_MS,
  CodingAgentSessionSeenService,
} from "../coding-agent-session-seen.service";
import { TestClock, TestProjectService } from "../../repositories/__tests__/fixtures/coding-agent.fixture";

function createFixture(at = 1_000_000) {
  const clock = new TestClock(at);
  const projects = new TestProjectService();
  const service = CodingAgentSessionSeenService.create({ projects, clock });

  return { clock, projects, service };
}

describe("CodingAgentSessionSeenService", () => {
  describe("given one project folding sessions", () => {
    describe("when its sessions commit repeatedly inside the window", () => {
      it("touches the project once and holds the rest back", async () => {
        const { clock, projects, service } = createFixture();

        await service.record(["proj-1"]);
        clock.set(1_030_000);
        await service.record(["proj-1"]);
        clock.set(1_060_000);
        await service.record(["proj-1", "proj-1"]);

        expect(projects.sessionActivity).toEqual([
          {
            projectId: "proj-1",
            at: new Date(1_000_000),
          },
        ]);
      });
    });

    describe("when the window has passed", () => {
      it("touches the project again", async () => {
        const { clock, projects, service } = createFixture();

        await service.record(["proj-1"]);
        clock.set(1_000_000 + CODING_AGENT_SESSION_SEEN_WINDOW_MS + 1);
        await service.record(["proj-1"]);

        expect(projects.sessionActivity).toHaveLength(2);
      });
    });
  });

  describe("given one commit batch carrying several projects", () => {
    describe("when the batch commits", () => {
      it("touches each project on its own clock", async () => {
        const { projects, service } = createFixture();

        await service.record(["proj-1", "proj-2"]);

        expect(projects.sessionActivity).toEqual([
          { projectId: "proj-1", at: new Date(1_000_000) },
          { projectId: "proj-2", at: new Date(1_000_000) },
        ]);
      });
    });
  });

  describe("given a project write that fails", () => {
    describe("when the next commit arrives", () => {
      it("swallows the error and lets the commit retry", async () => {
        const { clock, projects, service } = createFixture();
        const touchCodingAgentSessionSeen = vi
          .spyOn(projects, "touchCodingAgentSessionSeen")
          .mockRejectedValueOnce(new Error("postgres away"))
          .mockResolvedValue(undefined);

        await expect(service.record(["proj-1"])).resolves.toBeUndefined();

        // The failed attempt released its hold, so the very next commit
        // retries instead of waiting out the window.
        clock.set(1_001_000);
        await service.record(["proj-1"]);
        expect(touchCodingAgentSessionSeen).toHaveBeenCalledTimes(2);
      });
    });

    describe("when the failure lands after a newer window was claimed", () => {
      it("keeps the hold the newer call placed", async () => {
        const { clock, projects, service } = createFixture();
        let failFirst: ((error: Error) => void) | undefined;
        const touchCodingAgentSessionSeen = vi
          .spyOn(projects, "touchCodingAgentSessionSeen")
          .mockImplementationOnce(
            () =>
              new Promise<void>((_, reject) => {
                failFirst = reject;
              }),
          )
          .mockResolvedValue(undefined);

        // The first write is still in flight when its window expires and
        // the next commit claims a fresh one.
        const firstCall = service.record(["proj-1"]);
        clock.set(1_000_000 + CODING_AGENT_SESSION_SEEN_WINDOW_MS + 1);
        await service.record(["proj-1"]);
        expect(touchCodingAgentSessionSeen).toHaveBeenCalledTimes(2);

        failFirst!(new Error("postgres away"));
        await firstCall;

        // The stale failure must not drop the hold the second call placed:
        // a commit inside the fresh window stays held back.
        clock.set(1_000_000 + CODING_AGENT_SESSION_SEEN_WINDOW_MS + 1_001);
        await service.record(["proj-1"]);
        expect(touchCodingAgentSessionSeen).toHaveBeenCalledTimes(2);
      });
    });
  });
});
