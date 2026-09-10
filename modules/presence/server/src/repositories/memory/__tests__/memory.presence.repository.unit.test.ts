/**
 * @vitest-environment node
 *
 * The memory presence repository reads back what it writes, proving the
 * in-memory backend is not a stub. A write followed by a read through the
 * same instances is what proves the memory backend works.
 */
import { instantiateRepositories } from "@langwatch/runtime-composition";
import { presenceRepositories } from "@langwatch/presence-server";
import { describe, expect, it } from "vitest";

const PROJECT_ID = "project-1";
const SESSION_ID = "session-1";
const USER_ID = "user-1";

describe("given the memory-backed presence repositories", () => {
  describe("when upserting a presence session", () => {
    it("reads back the session it just wrote", async () => {
      const repositories = instantiateRepositories(presenceRepositories, {
        backend: "memory",
        members: {},
      });

      const session = {
        sessionId: SESSION_ID,
        projectId: PROJECT_ID,
        user: {
          id: USER_ID,
          name: "Test User",
          image: null,
        },
        location: {
          lens: "traces" as const,
          route: {},
        },
        updatedAt: Date.now(),
      };

      await repositories.sessions.upsert(session, 300);

      const found = await repositories.sessions.findSession({
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
      });

      expect(found).toMatchObject({
        sessionId: SESSION_ID,
        projectId: PROJECT_ID,
        user: { id: USER_ID, name: "Test User" },
      });
    });

    it("lists all sessions in a project", async () => {
      const repositories = instantiateRepositories(presenceRepositories, {
        backend: "memory",
        members: {},
      });

      await repositories.sessions.upsert(
        {
          sessionId: "session-a",
          projectId: PROJECT_ID,
          user: { id: "user-a", name: "Alice", image: null },
          location: { lens: "traces" as const, route: {} },
          updatedAt: Date.now(),
        },
        300,
      );

      await repositories.sessions.upsert(
        {
          sessionId: "session-b",
          projectId: PROJECT_ID,
          user: { id: "user-b", name: "Bob", image: null },
          location: { lens: "evaluations" as const, route: {} },
          updatedAt: Date.now(),
        },
        300,
      );

      const sessions = await repositories.sessions.listByProject(PROJECT_ID);

      expect(sessions).toHaveLength(2);
      expect(sessions.map((s) => s.sessionId)).toEqual(expect.arrayContaining(["session-a", "session-b"]));
    });

    it("removes a session", async () => {
      const repositories = instantiateRepositories(presenceRepositories, {
        backend: "memory",
        members: {},
      });

      await repositories.sessions.upsert(
        {
          sessionId: SESSION_ID,
          projectId: PROJECT_ID,
          user: { id: USER_ID, name: "Test User", image: null },
          location: { lens: "traces" as const, route: {} },
          updatedAt: Date.now(),
        },
        300,
      );

      const removed = await repositories.sessions.remove({
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
      });

      expect(removed).toBe(true);

      const found = await repositories.sessions.findSession({
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
      });

      expect(found).toBeUndefined();
    });
  });
});
