/**
 * The Postgres side of the cache-rule catalogue. Guards three facts still load-bearing after
 * the App's own copy was removed: bundle filter/order (first-match-wins), the mode column
 * recomputed from the write, and the audit row sharing the write's transaction.
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { GatewayAudit, GatewayChangeEvents } from "../../../app/gateway.members.ts";
import {
  PrismaGatewayCacheRuleRepository,
  type GatewayCacheRuleDatabase,
} from "../prisma.gateway-cache-rule.repository.ts";

const storedRow = {
  id: "rule_01",
  organizationId: "org_01",
  name: "enterprise-force",
  description: null,
  priority: 200,
  enabled: true,
  matchers: { vk_tags: ["tier=enterprise"] },
  action: { mode: "force", ttl: 600 },
  modeEnum: "FORCE",
  archivedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  createdById: "usr_01",
};

type Call = { args: unknown };

function recordingDatabase(row: typeof storedRow | null = storedRow) {
  const calls: Record<string, Call[]> = {
    findMany: [],
    findFirst: [],
    create: [],
    update: [],
  };
  const delegate = {
    findMany: (args: unknown) => {
      calls.findMany!.push({ args });
      return Promise.resolve(row ? [row] : []);
    },
    findFirst: (args: unknown) => {
      calls.findFirst!.push({ args });
      return Promise.resolve(row);
    },
    create: (args: unknown) => {
      calls.create!.push({ args });
      return Promise.resolve({
        ...storedRow,
        ...(args as { data: Record<string, unknown> }).data,
      });
    },
    update: (args: unknown) => {
      calls.update!.push({ args });
      return Promise.resolve({
        ...storedRow,
        ...(args as { data: Record<string, unknown> }).data,
      });
    },
  };
  const database = {
    gatewayCacheRule: delegate,
    $transaction: (run: (client: unknown) => unknown) => run({ gatewayCacheRule: delegate }),
  } as unknown as GatewayCacheRuleDatabase;
  return { database, calls, delegate };
}

function recordingPorts() {
  const changes: { kind: string; inTransaction: boolean }[] = [];
  const audits: { action: string; inTransaction: boolean }[] = [];
  return {
    changes,
    audits,
    changesPort: {
      append: (input: { kind: string }, transaction?: unknown) => {
        changes.push({ kind: input.kind, inTransaction: transaction !== undefined });
        return Promise.resolve({ revision: 1n });
      },
      since: () => Promise.resolve({ currentRevision: 1n, events: [] }),
      currentRevision: () => Promise.resolve(1n),
    } satisfies GatewayChangeEvents,
    auditPort: {
      append: (input: { action: string }, transaction?: unknown) => {
        audits.push({ action: input.action, inTransaction: transaction !== undefined });
        return Promise.resolve();
      },
    } satisfies GatewayAudit,
  };
}

describe("PrismaGatewayCacheRuleRepository", () => {
  describe("when the gateway asks for an organization's rule bundle", () => {
    it("takes only live enabled rules, highest priority first and oldest first within a priority", async () => {
      const { database, calls } = recordingDatabase();
      const ports = recordingPorts();
      const repository = PrismaGatewayCacheRuleRepository.create({
        database,
        changes: ports.changesPort,
        audit: ports.auditPort,
      });

      await repository.findEnabledForOrganization("org_01");

      expect(calls.findMany![0]!.args).toEqual({
        where: { organizationId: "org_01", archivedAt: null, enabled: true },
        orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      });
    });
  });

  describe("when a rule's action changes", () => {
    let calls: ReturnType<typeof recordingDatabase>["calls"];
    let ports: ReturnType<typeof recordingPorts>;
    let repository: ReturnType<typeof PrismaGatewayCacheRuleRepository.create>;

    beforeEach(() => {
      const recorded = recordingDatabase();
      calls = recorded.calls;
      ports = recordingPorts();
      repository = PrismaGatewayCacheRuleRepository.create({
        database: recorded.database,
        changes: ports.changesPort,
        audit: ports.auditPort,
      });
    });

    it("recomputes the indexed mode column from the action the write ends with", async () => {
      await repository.update({
        id: "rule_01",
        organizationId: "org_01",
        action: { mode: "disable" },
        actorUserId: "usr_01",
      });

      const written = calls.update![0]!.args as { data: { modeEnum: string } };
      expect(written.data.modeEnum).toBe("DISABLE");
    });

    it("leaves the mode column on the stored action when the write does not name one", async () => {
      await repository.update({
        id: "rule_01",
        organizationId: "org_01",
        name: "renamed",
        actorUserId: "usr_01",
      });

      const written = calls.update![0]!.args as { data: { modeEnum: string } };
      expect(written.data.modeEnum).toBe("FORCE");
    });
  });

  describe("when a rule is created", () => {
    /** @scenario "A cache-rule mutation refreshes the Gateway configuration atomically" */
    it("writes the row, the revision bump and the audit row in one transaction", async () => {
      const { database, calls } = recordingDatabase();
      const ports = recordingPorts();
      const repository = PrismaGatewayCacheRuleRepository.create({
        database,
        changes: ports.changesPort,
        audit: ports.auditPort,
      });

      await repository.create({
        organizationId: "org_01",
        name: "enterprise-force",
        matchers: { vk_tags: ["tier=enterprise"] },
        action: { mode: "force", ttl: 600 },
        actorUserId: "usr_01",
      });

      expect(calls.create).toHaveLength(1);
      expect(ports.changes).toEqual([{ kind: "CACHE_RULE_CREATED", inTransaction: true }]);
      expect(ports.audits).toEqual([{ action: "gateway.cache_rule.created", inTransaction: true }]);
    });
  });

  describe("when a rule is updated", () => {
    /** @scenario "A cache-rule mutation refreshes the Gateway configuration atomically" */
    it("writes the row, the revision bump and the audit row in one transaction", async () => {
      const { database, calls } = recordingDatabase();
      const ports = recordingPorts();
      const repository = PrismaGatewayCacheRuleRepository.create({
        database,
        changes: ports.changesPort,
        audit: ports.auditPort,
      });

      await repository.update({
        id: "rule_01",
        organizationId: "org_01",
        name: "renamed",
        actorUserId: "usr_01",
      });

      expect(calls.update).toHaveLength(1);
      expect(ports.changes).toEqual([{ kind: "CACHE_RULE_UPDATED", inTransaction: true }]);
      expect(ports.audits).toEqual([{ action: "gateway.cache_rule.updated", inTransaction: true }]);
    });
  });

  describe("when a rule is archived", () => {
    /** @scenario "A cache-rule mutation refreshes the Gateway configuration atomically" */
    it("stamps archivedAt and raises the revision and the audit row in the same transaction", async () => {
      const { database, calls } = recordingDatabase();
      const ports = recordingPorts();
      const repository = PrismaGatewayCacheRuleRepository.create({
        database,
        changes: ports.changesPort,
        audit: ports.auditPort,
      });

      await repository.archive({
        id: "rule_01",
        organizationId: "org_01",
        actorUserId: "usr_01",
      });

      const written = calls.update![0]!.args as { data: { archivedAt: Date } };
      expect(written.data.archivedAt).toBeInstanceOf(Date);
      expect(ports.changes).toEqual([{ kind: "CACHE_RULE_DELETED", inTransaction: true }]);
      expect(ports.audits).toEqual([{ action: "gateway.cache_rule.deleted", inTransaction: true }]);
    });
  });
});
