/**
 * @vitest-environment node
 * The memory audit log repository reads back what it writes through the same instances, proving the
 * in-memory backend is not a stub.
 */
import { instantiateRepositories } from "@langwatch/process";
import { describe, expect, it } from "vitest";

import { auditLogRepositories } from "../../audit-log-repositories.registry.ts";

const PROJECT_ID = "project-1";
const USER_ID = "user-1";

describe("given the memory-backed audit log repositories", () => {
  describe("when writing an audit log entry", () => {
    it("reads back the entry it just wrote", async () => {
      const repositories = instantiateRepositories(auditLogRepositories, {
        tier: "memory",
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
        tier: "memory",
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
        tier: "memory",
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

  describe("when reading one person's recent touches", () => {
    it("answers only their rows in the project and families asked, newest first", async () => {
      const repositories = instantiateRepositories(auditLogRepositories, {
        tier: "memory",
        members: {},
      });
      const write = (userId: string, projectId: string, action: string) =>
        repositories.entries.create({ userId, projectId, action, args: { action } });

      await write(USER_ID, PROJECT_ID, "workflow.create");
      await write(USER_ID, PROJECT_ID, "dataset.update");
      await write("someone-else", PROJECT_ID, "workflow.update");
      await write(USER_ID, "project-2", "workflow.update");
      await write(USER_ID, PROJECT_ID, "project.update");

      const touches = await repositories.recentTouches.findRecentTouches({
        userId: USER_ID,
        projectId: PROJECT_ID,
        actionPrefixes: ["workflow.", "dataset."],
        limit: 10,
      });

      expect(touches.map((touch) => touch.action)).toEqual(["dataset.update", "workflow.create"]);
    });
  });

  describe("when reading a trail by target kind", () => {
    /** @scenario "A trail lists the entries recorded under its target kind, newest first" */
    it("answers only that kind, newest first, up to the limit, with absent fields as null", async () => {
      const { entries } = instantiateRepositories(auditLogRepositories, {
        tier: "memory",
        members: {},
      });
      const write = (targetId: string, targetKind: string, occurredAt: number) =>
        entries.createOnce({
          entry: { action: "ops.scheduler.run_now", targetKind, targetId },
          idempotencyKey: `key-${targetId}`,
          occurredAt,
        });
      await write("schedule-1", "scheduled_job", 1_000);
      await write("schedule-3", "scheduled_job", 3_000);
      await write("queue-1", "queue", 4_000);
      await write("schedule-2", "scheduled_job", 2_000);

      const trail = await entries.findByTargetKind({ targetKind: "scheduled_job", limit: 2 });

      expect(trail).toEqual([
        {
          id: expect.any(String),
          createdAt: new Date(3_000),
          action: "ops.scheduler.run_now",
          targetId: "schedule-3",
          projectId: null,
          userId: null,
          metadata: null,
        },
        expect.objectContaining({ targetId: "schedule-2" }),
      ]);
    });

    /** @scenario "A target kind nothing was recorded under lists nothing" */
    it("answers an empty list for a kind nothing was recorded under", async () => {
      const { entries } = instantiateRepositories(auditLogRepositories, {
        tier: "memory",
        members: {},
      });
      await entries.create({ action: "queue_drain_group", targetKind: "queue", targetId: "q" });

      await expect(
        entries.findByTargetKind({ targetKind: "no_such_kind", limit: 10 }),
      ).resolves.toEqual([]);
    });
  });

  describe("when the SIEM export reads an organisation's trail", () => {
    /** @scenario "An organisation's trail reads its own and its projects' entries oldest first after a watermark" */
    it("answers the organisation's and its projects' entries after the watermark, oldest first", async () => {
      const { entries } = instantiateRepositories(auditLogRepositories, {
        tier: "memory",
        members: {},
      });
      const write = (
        key: string,
        at: number,
        scope: { organizationId?: string; projectId?: string },
      ) =>
        entries.createOnce({
          entry: { ...scope, action: `test.${key}` },
          idempotencyKey: `audit_${key}`,
          occurredAt: at,
        });
      await write("org-first", 1_000, { organizationId: "org-1" });
      await write("project-same-ms", 2_000, { projectId: PROJECT_ID });
      await write("org-same-ms", 2_000, { organizationId: "org-1" });
      await write("other-org", 2_500, { organizationId: "org-2" });
      await write("project-last", 3_000, { projectId: PROJECT_ID });

      const read = (afterMs: number, afterId: string) =>
        entries.findForOrganization({
          organizationId: "org-1",
          projectIds: [PROJECT_ID],
          afterMs,
          afterId,
          limit: 2,
        });
      const first = await read(0, "");
      const second = await read(first[1]!.createdAt.getTime(), first[1]!.id);
      const pages = [...first, ...second];

      expect(pages.map((entry) => entry.createdAt.getTime())).toEqual([1_000, 2_000, 2_000, 3_000]);
      expect(pages[1]!.id < pages[2]!.id).toBe(true);
      expect(pages.map((entry) => entry.action)).not.toContain("test.other-org");
    });
  });

  describe("when many entries share one millisecond and are paged by the id watermark", () => {
    it("returns each entry once, in the code-unit order the watermark compares", async () => {
      const { entries } = instantiateRepositories(auditLogRepositories, {
        tier: "memory",
        members: {},
      });
      for (let index = 0; index < 30; index += 1) {
        await entries.createOnce({
          entry: { organizationId: "org-order", action: `test.same-ms-${index}` },
          idempotencyKey: `audit_same_ms_${index}`,
          occurredAt: 5_000,
        });
      }

      const seen: string[] = [];
      let afterMs = 0;
      let afterId = "";
      for (let pages = 0; pages < 20; pages += 1) {
        const page = await entries.findForOrganization({
          organizationId: "org-order",
          projectIds: [],
          afterMs,
          afterId,
          limit: 4,
        });
        seen.push(...page.map((entry) => entry.id));
        const last = page.at(-1);
        if (!last) break;
        afterMs = last.createdAt.getTime();
        afterId = last.id;
      }

      expect(new Set(seen).size).toBe(30);
      expect(seen).toHaveLength(30);
      expect(seen).toEqual(seen.toSorted());
    });
  });
});
