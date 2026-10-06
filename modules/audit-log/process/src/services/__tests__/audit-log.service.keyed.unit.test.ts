/**
 * @vitest-environment node
 * A producer's outbox delivers an audit intent at least once;
 * the key makes the write happen once.
 * Spec: modules/audit-log/specs/audit-log.feature (the audit outbox rule).
 */
import { generate } from "@langwatch/ksuid";
import { instantiateRepositories } from "@langwatch/process";
import { describe, expect, it } from "vitest";

import { auditLogRepositories } from "../../repositories/audit-log-repositories.registry.ts";
import { AuditLogService } from "../audit-log.service.ts";

function keyedAuditLog() {
  const repositories = instantiateRepositories(auditLogRepositories, {
    tier: "memory",
    members: {},
  });
  const service = AuditLogService.create({ repository: repositories.entries, maxArgsBytes: 4096 });
  const history = () =>
    repositories.entries.findEntityHistory({
      projectId: "project-1",
      actionPrefix: "emailSuppression.",
      entityId: "trigger-1",
      argumentNames: ["triggerId"],
      limit: 10,
    });
  return { service, history };
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

      expect(first.id).toBe(idempotencyKey);
      expect(second).toEqual(first);
      expect(await history()).toHaveLength(1);
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
