/**
 * @vitest-environment node
 *
 * The memory audit log repository reads back what it writes, proving the
 * in-memory backend is not a stub. A write followed by a read through the
 * same instances is what proves the memory backend works, the way a real
 * database would.
 */
import { instantiateRepositories } from "@langwatch/runtime-composition";
import { auditLogRepositories } from "@langwatch/enterprise-audit-log-server";
import { describe, expect, it } from "vitest";

const PROJECT_ID = "project-1";
const USER_ID = "user-1";

describe("given the memory-backed audit log repositories", () => {
  describe("when writing an audit log entry", () => {
    it("reads back the entry it just wrote", async () => {
      const repositories = instantiateRepositories(auditLogRepositories, {
        backend: "memory",
        members: {},
      });

      await repositories.entries.create({
        userId: USER_ID,
        projectId: PROJECT_ID,
        action: "test.create",
        args: { entityId: "entity-1", name: "Test" },
      });

      const history = await repositories.entries.findEntityHistory({
        projectId: PROJECT_ID,
        actionPrefix: "test.",
        entityId: "entity-1",
        argumentNames: ["entityId"],
        limit: 10,
      });

      expect(history).toHaveLength(1);
      expect(history[0]?.userId).toBe(USER_ID);
      expect(history[0]?.action).toBe("test.create");
      expect(history[0]?.args).toEqual({ entityId: "entity-1", name: "Test" });
    });

    it("sorts history by creation date descending", async () => {
      const repositories = instantiateRepositories(auditLogRepositories, {
        backend: "memory",
        members: {},
      });

      await repositories.entries.create({
        userId: USER_ID,
        projectId: PROJECT_ID,
        action: "test.update",
        args: { entityId: "entity-2" },
      });

      await repositories.entries.create({
        userId: USER_ID,
        projectId: PROJECT_ID,
        action: "test.update",
        args: { entityId: "entity-2" },
      });

      const history = await repositories.entries.findEntityHistory({
        projectId: PROJECT_ID,
        actionPrefix: "test.update",
        entityId: "entity-2",
        argumentNames: ["entityId"],
        limit: 10,
      });

      expect(history).toHaveLength(2);
      expect(history[0]?.createdAt.getTime()).toBeGreaterThanOrEqual(
        history[1]?.createdAt.getTime() ?? 0,
      );
    });

    it("respects the limit parameter", async () => {
      const repositories = instantiateRepositories(auditLogRepositories, {
        backend: "memory",
        members: {},
      });

      await repositories.entries.create({
        userId: USER_ID,
        projectId: PROJECT_ID,
        action: "test.delete",
        args: { entityId: "entity-3" },
      });

      await repositories.entries.create({
        userId: USER_ID,
        projectId: PROJECT_ID,
        action: "test.delete",
        args: { entityId: "entity-3" },
      });

      const history = await repositories.entries.findEntityHistory({
        projectId: PROJECT_ID,
        actionPrefix: "test.delete",
        entityId: "entity-3",
        argumentNames: ["entityId"],
        limit: 1,
      });

      expect(history).toHaveLength(1);
    });
  });
});
