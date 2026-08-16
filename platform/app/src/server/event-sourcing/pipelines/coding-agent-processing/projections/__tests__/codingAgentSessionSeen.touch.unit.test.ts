/**
 * The inline Sessions-destination stamp on the fold store's commit seam:
 * one throttled, error-swallowing project touch per window.
 *
 * @see specs/coding-agent/project-menu-links.feature
 */
import { describe, expect, it, vi } from "vitest";

import {
  CODING_AGENT_SESSION_SEEN_WINDOW_MS,
  createCodingAgentSessionSeenTouch,
} from "../codingAgentSessionSeen.touch";

describe("createCodingAgentSessionSeenTouch", () => {
  describe("when a project's sessions commit repeatedly inside the window", () => {
    it("touches the project once and holds the rest back", async () => {
      const touchCodingAgentSessionSeen = vi.fn().mockResolvedValue(undefined);
      let clock = 1_000_000;
      const touch = createCodingAgentSessionSeenTouch({
        touchCodingAgentSessionSeen,
        now: () => clock,
      });

      await touch(["proj-1"]);
      clock += 30_000;
      await touch(["proj-1"]);
      clock += 30_000;
      await touch(["proj-1", "proj-1"]);

      expect(touchCodingAgentSessionSeen).toHaveBeenCalledTimes(1);
      expect(touchCodingAgentSessionSeen).toHaveBeenCalledWith({
        projectId: "proj-1",
        at: new Date(1_000_000),
      });
    });
  });

  describe("when the window has passed", () => {
    it("touches the project again", async () => {
      const touchCodingAgentSessionSeen = vi.fn().mockResolvedValue(undefined);
      let clock = 1_000_000;
      const touch = createCodingAgentSessionSeenTouch({
        touchCodingAgentSessionSeen,
        now: () => clock,
      });

      await touch(["proj-1"]);
      clock += CODING_AGENT_SESSION_SEEN_WINDOW_MS + 1;
      await touch(["proj-1"]);

      expect(touchCodingAgentSessionSeen).toHaveBeenCalledTimes(2);
    });
  });

  describe("when one commit batch carries several projects", () => {
    it("touches each project on its own clock", async () => {
      const touchCodingAgentSessionSeen = vi.fn().mockResolvedValue(undefined);
      const touch = createCodingAgentSessionSeenTouch({
        touchCodingAgentSessionSeen,
        now: () => 1_000_000,
      });

      await touch(["proj-1", "proj-2"]);

      expect(touchCodingAgentSessionSeen).toHaveBeenCalledTimes(2);
      expect(touchCodingAgentSessionSeen).toHaveBeenCalledWith({
        projectId: "proj-1",
        at: new Date(1_000_000),
      });
      expect(touchCodingAgentSessionSeen).toHaveBeenCalledWith({
        projectId: "proj-2",
        at: new Date(1_000_000),
      });
    });
  });

  describe("when the project write fails", () => {
    it("swallows the error and lets the next commit retry", async () => {
      const touchCodingAgentSessionSeen = vi
        .fn()
        .mockRejectedValueOnce(new Error("postgres away"))
        .mockResolvedValue(undefined);
      let clock = 1_000_000;
      const touch = createCodingAgentSessionSeenTouch({
        touchCodingAgentSessionSeen,
        now: () => clock,
      });

      await expect(touch(["proj-1"])).resolves.toBeUndefined();

      // The failed attempt released its hold, so the very next commit
      // retries instead of waiting out the window.
      clock += 1_000;
      await touch(["proj-1"]);
      expect(touchCodingAgentSessionSeen).toHaveBeenCalledTimes(2);
    });
  });
});
