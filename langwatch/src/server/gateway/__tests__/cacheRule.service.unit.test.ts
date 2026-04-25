import { beforeEach, describe, expect, it, vi } from "vitest";

import { GatewayCacheRuleService } from "../cacheRule.service";

function mockPrisma(gatewayCacheRule: Record<string, any>): any {
  return {
    gatewayCacheRule,
    gatewayChangeEvent: { create: vi.fn(async () => ({ revision: 1n })) },
    auditLog: { create: vi.fn(async () => undefined) },
    $transaction: async (cb: (tx: any) => any) =>
      cb({
        gatewayCacheRule,
        gatewayChangeEvent: { create: vi.fn(async () => ({ revision: 1n })) },
        auditLog: { create: vi.fn(async () => undefined) },
      }),
  };
}

describe("GatewayCacheRuleService", () => {
  describe("when creating a rule", () => {
    it("persists matchers + action JSON and captures the mode enum", async () => {
      const created = {
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
        createdAt: new Date(),
        updatedAt: new Date(),
        createdById: "usr_01",
      };
      const createSpy = vi.fn(async () => created);
      const prisma = mockPrisma({ create: createSpy });

      const sut = GatewayCacheRuleService.create(prisma);
      const row = await sut.create({
        organizationId: "org_01",
        name: "enterprise-force",
        priority: 200,
        matchers: { vk_tags: ["tier=enterprise"] },
        action: { mode: "force", ttl: 600 },
        actorUserId: "usr_01",
      });

      expect(row.id).toBe("rule_01");
      expect(createSpy).toHaveBeenCalledOnce();
      const args = (createSpy.mock.calls[0] as any[])[0] as any;
      expect(args.data.modeEnum).toBe("FORCE");
      expect(args.data.priority).toBe(200);
      expect(args.data.action).toEqual({ mode: "force", ttl: 600 });
    });

    describe("when matchers.vk_tags is not an array", () => {
      it("throws BAD_REQUEST", async () => {
        const prisma = mockPrisma({ create: vi.fn() });
        const sut = GatewayCacheRuleService.create(prisma);

        await expect(
          sut.create({
            organizationId: "org_01",
            name: "bad",
            matchers: { vk_tags: "not-an-array" as any },
            action: { mode: "force" },
            actorUserId: "usr_01",
          }),
        ).rejects.toThrow(/vk_tags must be an array/);
      });
    });

    describe("when request_metadata is not a flat object", () => {
      it("throws BAD_REQUEST", async () => {
        const prisma = mockPrisma({ create: vi.fn() });
        const sut = GatewayCacheRuleService.create(prisma);

        await expect(
          sut.create({
            organizationId: "org_01",
            name: "bad",
            matchers: { request_metadata: [] as any },
            action: { mode: "force" },
            actorUserId: "usr_01",
          }),
        ).rejects.toThrow(/request_metadata must be a flat key-value object/);
      });
    });

    describe("when action.mode is unknown", () => {
      it("throws BAD_REQUEST", async () => {
        const prisma = mockPrisma({ create: vi.fn() });
        const sut = GatewayCacheRuleService.create(prisma);

        await expect(
          sut.create({
            organizationId: "org_01",
            name: "bad",
            matchers: {},
            action: { mode: "bogus" as any },
            actorUserId: "usr_01",
          }),
        ).rejects.toThrow(/Unknown cache-rule action mode/);
      });
    });

    describe("when action.ttl is out of range", () => {
      it("throws BAD_REQUEST for negative", async () => {
        const prisma = mockPrisma({ create: vi.fn() });
        const sut = GatewayCacheRuleService.create(prisma);
        await expect(
          sut.create({
            organizationId: "org_01",
            name: "bad",
            matchers: {},
            action: { mode: "force", ttl: -5 },
            actorUserId: "usr_01",
          }),
        ).rejects.toThrow(/ttl must be between 0 and 86400/);
      });

      it("throws BAD_REQUEST for > 86400", async () => {
        const prisma = mockPrisma({ create: vi.fn() });
        const sut = GatewayCacheRuleService.create(prisma);
        await expect(
          sut.create({
            organizationId: "org_01",
            name: "bad",
            matchers: {},
            action: { mode: "force", ttl: 100_000 },
            actorUserId: "usr_01",
          }),
        ).rejects.toThrow(/ttl must be between 0 and 86400/);
      });
    });
  });

  describe("when listing bundle projection", () => {
    it("filters by enabled + archived, orders by priority desc + createdAt asc", async () => {
      const findMany = vi.fn(async () => []);
      const prisma = mockPrisma({ findMany });

      const sut = GatewayCacheRuleService.create(prisma);
      await sut.bundleFor("org_01");

      expect(findMany).toHaveBeenCalledOnce();
      const args = (findMany.mock.calls[0] as any[])[0] as any;
      expect(args.where).toEqual({
        organizationId: "org_01",
        archivedAt: null,
        enabled: true,
      });
      expect(args.orderBy).toEqual([
        { priority: "desc" },
        { createdAt: "asc" },
      ]);
    });
  });

  describe("when updating a rule", () => {
    it("recomputes modeEnum when action changes", async () => {
      const existing = {
        id: "rule_01",
        organizationId: "org_01",
        name: "x",
        description: null,
        priority: 100,
        enabled: true,
        matchers: {},
        action: { mode: "respect" },
        modeEnum: "RESPECT",
        archivedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdById: "usr_01",
      };
      const updateSpy = vi.fn(async () => ({
        ...existing,
        action: { mode: "disable" },
        modeEnum: "DISABLE",
      }));
      const findFirst = vi.fn(async () => existing);
      const prisma = mockPrisma({ update: updateSpy, findFirst });

      const sut = GatewayCacheRuleService.create(prisma);
      const updated = await sut.update({
        id: "rule_01",
        organizationId: "org_01",
        action: { mode: "disable" },
        actorUserId: "usr_01",
      });

      expect(updated.modeEnum).toBe("DISABLE");
      const args = (updateSpy.mock.calls[0] as any[])[0] as any;
      expect(args.data.modeEnum).toBe("DISABLE");
      expect(args.data.action).toEqual({ mode: "disable" });
    });
  });

  describe("when archiving a rule", () => {
    it("sets archivedAt instead of hard-deleting", async () => {
      const existing = {
        id: "rule_01",
        organizationId: "org_01",
        name: "x",
        description: null,
        priority: 100,
        enabled: true,
        matchers: {},
        action: { mode: "respect" },
        modeEnum: "RESPECT",
        archivedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdById: "usr_01",
      };
      const updateSpy = vi.fn(async () => ({
        ...existing,
        archivedAt: new Date(),
      }));
      const findFirst = vi.fn(async () => existing);
      const prisma = mockPrisma({ update: updateSpy, findFirst });

      const sut = GatewayCacheRuleService.create(prisma);
      await sut.archive({
        id: "rule_01",
        organizationId: "org_01",
        actorUserId: "usr_01",
      });

      const args = (updateSpy.mock.calls[0] as any[])[0] as any;
      expect(args.data.archivedAt).toBeInstanceOf(Date);
    });
  });
});
