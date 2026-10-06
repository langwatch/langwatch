/**
 * @vitest-environment node
 * A producer's outbox delivers an audit intent at least once;
 * the key makes the write happen once.
 * Spec: modules/audit-log/specs/audit-log.feature (the audit outbox rule).
 */
import { generate } from "@langwatch/ksuid";
import { describe, expect, it } from "vitest";

import { MemoryAuditLogRepository } from "../../repositories/memory/memory.audit-log.repository.ts";
import { MemoryAuditLogStore } from "../../repositories/memory/memory.audit-log.store.ts";
import { AuditLogService } from "../audit-log.service.ts";

function keyedAuditLog() {
  const store = new MemoryAuditLogStore();
  const repository = MemoryAuditLogRepository.create({ store });
  const service = AuditLogService.create({ repository, maxArgsBytes: 4096 });
  const history = () =>
    repository.findEntityHistory({
      projectId: "project-1",
      actionPrefix: "emailSuppression.",
      entityId: "trigger-1",
      argumentNames: ["triggerId"],
      limit: 10,
    });
  return { service, history, store };
}

const entry = {
  userId: "user-1",
  projectId: "project-1",
  action: "emailSuppression.getAll",
  args: { triggerId: "trigger-1" },
};

describe("AuditLogService.record with an idempotency key", () => {
  describe("when the producer's outbox delivers the same keyed entry twice", () => {
    /** @scenario "A keyed audit entry recorded twice writes one row" */
    it("stores one row under the key and answers it both times", async () => {
      const { service, history } = keyedAuditLog();
      const idempotencyKey = generate("audit").toString();

      const first = await service.record({ ...entry, idempotencyKey });
      const second = await service.record({ ...entry, idempotencyKey });

      expect(second).toEqual(first);
      expect(await history()).toHaveLength(1);
    });
  });

  describe("when the producer's outbox delivers a keyed entry", () => {
    /** @scenario "A keyed audit row takes the table's own id, not its key" */
    it("stores the key beside the row's own id", async () => {
      const { service, store } = keyedAuditLog();
      const idempotencyKey = generate("audit").toString();

      const recorded = await service.record({ ...entry, idempotencyKey });

      expect(recorded.id).not.toBe(idempotencyKey);
      expect(store.rows.map((row) => [row.id, row.idempotencyKey])).toEqual([
        [recorded.id, idempotencyKey],
      ]);
    });
  });

  describe("when the outbox delivers the entry after the producer committed it", () => {
    /** @scenario "A keyed audit entry keeps the moment the producer committed it" */
    it("dates the row at the moment in the key", async () => {
      const { service, history } = keyedAuditLog();
      const key = generate("audit");

      const recorded = await service.record({ ...entry, idempotencyKey: key.toString() });

      expect(recorded.occurredAt).toBe(key.date.getTime());
      expect((await history())[0]?.createdAt.getTime()).toBe(key.date.getTime());
    });
  });

  describe("when the key is an id of another kind", () => {
    /** @scenario "An audit key that is not an audit id is refused" */
    it("refuses the write and stores nothing", async () => {
      const { service, history } = keyedAuditLog();

      await expect(
        service.record({ ...entry, idempotencyKey: generate("project").toString() }),
      ).rejects.toThrow(/audit/);
      expect(await history()).toHaveLength(0);
    });
  });
});
