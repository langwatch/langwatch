import {
  GatewayCacheRuleNotFoundError,
  type ArchiveGatewayCacheRuleInput,
  type CreateGatewayCacheRuleInput,
  type GatewayCacheRuleCursor,
  type GatewayCacheRuleResource,
  type UpdateGatewayCacheRuleInput,
} from "@langwatch/gateway-contract";
import { describe, expect, it } from "vitest";
import { GatewayCacheRuleRepository } from "../gateway-cache-rule.repository";
import { GatewayCacheRulePersistence } from "../../services/gateway-cache-rule.service";

const existingRule: GatewayCacheRuleResource = {
  id: "rule_01",
  organizationId: "org_01",
  name: "enterprise-force",
  description: null,
  priority: 200,
  enabled: true,
  matchers: { vk_tags: ["tier=enterprise"] },
  action: { mode: "force", ttl: 600 },
  mode: "FORCE",
  archivedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  createdById: "usr_01",
};

class MemoryCacheRuleRepository extends GatewayCacheRuleRepository {
  created: CreateGatewayCacheRuleInput | null = null;
  updated: UpdateGatewayCacheRuleInput | null = null;
  archived: ArchiveGatewayCacheRuleInput | null = null;

  constructor(private rule: GatewayCacheRuleResource | null) {
    super();
  }

  list(): Promise<GatewayCacheRuleResource[]> {
    return Promise.resolve(this.rule ? [this.rule] : []);
  }

  listPage(_: {
    organizationId: string;
    limit: number;
    cursor: GatewayCacheRuleCursor | null;
  }): Promise<GatewayCacheRuleResource[]> {
    return this.list();
  }

  tryGet({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<GatewayCacheRuleResource | null> {
    if (this.rule?.id === id && this.rule.organizationId === organizationId) {
      return Promise.resolve(this.rule);
    }
    return Promise.resolve(null);
  }

  create(input: CreateGatewayCacheRuleInput): Promise<GatewayCacheRuleResource> {
    this.created = input;
    this.rule = {
      ...existingRule,
      ...input,
      description: input.description ?? null,
      priority: input.priority ?? 100,
      enabled: input.enabled ?? true,
      mode: modeFromAction(input.action.mode),
    };
    return Promise.resolve(this.rule);
  }

  update(input: UpdateGatewayCacheRuleInput): Promise<GatewayCacheRuleResource> {
    this.updated = input;
    if (!this.rule) {
      throw new Error("The service verifies existence before update");
    }
    this.rule = {
      ...this.rule,
      ...input,
      action: input.action ?? this.rule.action,
      matchers: input.matchers ?? this.rule.matchers,
      mode: modeFromAction(input.action?.mode ?? this.rule.action.mode),
    };
    return Promise.resolve(this.rule);
  }

  archive(input: ArchiveGatewayCacheRuleInput): Promise<GatewayCacheRuleResource> {
    this.archived = input;
    if (!this.rule) {
      throw new Error("The service verifies existence before archive");
    }
    this.rule = { ...this.rule, archivedAt: new Date("2026-01-02T00:00:00.000Z") };
    return Promise.resolve(this.rule);
  }

  listEnabledForOrganization(organizationId: string): Promise<GatewayCacheRuleResource[]> {
    if (
      this.rule?.organizationId === organizationId &&
      this.rule.enabled &&
      !this.rule.archivedAt
    ) {
      return Promise.resolve([this.rule]);
    }
    return Promise.resolve([]);
  }
}

describe("GatewayCacheRulePersistence", () => {
  it("validates and forwards the canonical cache-rule create payload", async () => {
    const repository = new MemoryCacheRuleRepository(null);
    const service = GatewayCacheRulePersistence.create(repository);

    await expect(
      service.create({
        organizationId: "org_01",
        name: "enterprise-force",
        priority: 200,
        matchers: { vk_tags: ["tier=enterprise"] },
        action: { mode: "force", ttl: 600 },
        actorUserId: "usr_01",
      }),
    ).resolves.toMatchObject({ id: "rule_01", mode: "FORCE" });

    expect(repository.created).toEqual({
      organizationId: "org_01",
      name: "enterprise-force",
      priority: 200,
      matchers: { vk_tags: ["tier=enterprise"] },
      action: { mode: "force", ttl: 600 },
      actorUserId: "usr_01",
    });
  });

  it("rejects an out-of-range cache TTL before persistence", () => {
    const repository = new MemoryCacheRuleRepository(null);
    const service = GatewayCacheRulePersistence.create(repository);

    expect(() =>
      service.create({
        organizationId: "org_01",
        name: "bad-rule",
        matchers: {},
        action: { mode: "force", ttl: 86_401 },
        actorUserId: "usr_01",
      }),
    ).toThrow();

    expect(repository.created).toBeNull();
  });

  it("does not update a missing or cross-organization rule", async () => {
    const repository = new MemoryCacheRuleRepository(existingRule);
    const service = GatewayCacheRulePersistence.create(repository);

    await expect(
      service.update({
        id: "rule_01",
        organizationId: "org_other",
        action: { mode: "disable" },
        actorUserId: "usr_01",
      }),
    ).rejects.toBeInstanceOf(GatewayCacheRuleNotFoundError);

    expect(repository.updated).toBeNull();
  });

  it("forwards an update after checking the active organization-scoped rule", async () => {
    const repository = new MemoryCacheRuleRepository(existingRule);
    const service = GatewayCacheRulePersistence.create(repository);

    await expect(
      service.update({
        id: "rule_01",
        organizationId: "org_01",
        action: { mode: "disable" },
        actorUserId: "usr_01",
      }),
    ).resolves.toMatchObject({ mode: "DISABLE", action: { mode: "disable" } });

    expect(repository.updated).toEqual({
      id: "rule_01",
      organizationId: "org_01",
      action: { mode: "disable" },
      actorUserId: "usr_01",
    });
  });

  it("archives rather than removing the organization-scoped rule from the repository contract", async () => {
    const repository = new MemoryCacheRuleRepository(existingRule);
    const service = GatewayCacheRulePersistence.create(repository);

    await expect(
      service.archive({ id: "rule_01", organizationId: "org_01", actorUserId: "usr_01" }),
    ).resolves.toMatchObject({ id: "rule_01", archivedAt: new Date("2026-01-02T00:00:00.000Z") });

    expect(repository.archived).toEqual({
      id: "rule_01",
      organizationId: "org_01",
      actorUserId: "usr_01",
    });
  });
});

function modeFromAction(
  mode: GatewayCacheRuleResource["action"]["mode"],
): GatewayCacheRuleResource["mode"] {
  switch (mode) {
    case "respect":
      return "RESPECT";
    case "force":
      return "FORCE";
    case "disable":
      return "DISABLE";
  }
}
