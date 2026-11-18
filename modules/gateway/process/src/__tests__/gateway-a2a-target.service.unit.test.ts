import {
  GatewayA2aTargetHeadersNeedReplacingError,
  GatewayA2aTargetNameTakenError,
  GatewayA2aTargetNotFoundError,
} from "@langwatch/gateway-contract";
import { describe, expect, it } from "vitest";

import type {
  AppendGatewayAuditInput,
  GatewayAuditRepository,
} from "../repositories/gateway-audit.repository.ts";
import { MemoryGatewayA2aTargetRepository } from "../repositories/memory/memory.gateway-a2a-target.repository.ts";
import { MemoryGatewayChangeEventsRepository } from "../repositories/memory/memory.gateway-change-event.repository.ts";
import { a2aTargetToDto } from "../rules/gateway-a2a-target.rules.ts";
import { GatewayA2aTargetService } from "../services/gateway-a2a-target.service.ts";

const base = {
  organizationId: "org_1",
  agentName: "Billing agent",
  cardUrl: "https://billing.acme.test/.well-known/agent-card.json",
  upstreamUrl: "https://billing.acme.test/a2a",
  actorUserId: "user_1",
};

const noAudit: GatewayAuditRepository = { append: async () => {} };

function service(
  changeEvents = MemoryGatewayChangeEventsRepository.create(),
  auditLog: GatewayAuditRepository = noAudit,
  repository = MemoryGatewayA2aTargetRepository.create(),
) {
  return GatewayA2aTargetService.create({
    repository,
    changeEvents,
    auditLog,
    transactions: { run: (work) => work({}) },
  });
}

/** A repository that fails the test once anything asks it to unseal every target's headers. */
function sealedRepository() {
  const repository = MemoryGatewayA2aTargetRepository.create();
  const findAll = repository.findAll.bind(repository);
  repository.findAll = async (organizationId, options) => {
    if (options?.headers !== false) throw new Error("unsealed every target's headers");
    return findAll(organizationId, options);
  };
  return repository;
}

describe("GatewayA2aTargetService", () => {
  /** @scenario "a project admin manages the project's own targets" */
  it("lets a project manage only its own targets", async () => {
    const targets = service();
    const own = await targets.create({ ...base, projectId: "p1", name: "billing" });
    const other = await targets.create({ ...base, projectId: "p2", name: "billing" });
    const orgWide = await targets.create({ ...base, projectId: null, name: "shared" });
    const scope = { organizationId: base.organizationId, projectId: "p1" };

    expect((await targets.listForProject(scope)).map((t) => t.id)).toEqual([own.id]);
    await expect(
      targets.updateForProject({ ...scope, id: own.id, agentName: "Renamed", actorUserId: "u1" }),
    ).resolves.toMatchObject({ agentName: "Renamed" });
    await expect(
      targets.setBlockedForProject({
        ...scope,
        id: own.id,
        blocked: true,
        blockReason: "incident",
        actorUserId: "u1",
      }),
    ).resolves.toMatchObject({ blocked: true, blockReason: "incident" });
    for (const foreign of [other, orgWide]) {
      await expect(
        targets.updateForProject({ ...scope, id: foreign.id, agentName: "x", actorUserId: "u1" }),
      ).rejects.toThrow(GatewayA2aTargetNotFoundError);
      await expect(
        targets.archiveForProject({ ...scope, id: foreign.id, actorUserId: "u1" }),
      ).rejects.toThrow(GatewayA2aTargetNotFoundError);
    }
    await targets.archiveForProject({ ...scope, id: own.id, actorUserId: "u1" });
    expect(await targets.listForProject(scope)).toEqual([]);
  });

  it("refuses a second target with the same name in the same scope", async () => {
    const targets = service();
    await targets.create({ ...base, projectId: "p1", name: "billing" });
    await expect(targets.create({ ...base, projectId: "p1", name: "billing" })).rejects.toThrow(
      GatewayA2aTargetNameTakenError,
    );
    await expect(
      targets.create({ ...base, projectId: null, name: "billing" }),
    ).resolves.toMatchObject({ projectId: null });
  });

  it("checks a new name without unsealing any target's headers", async () => {
    const targets = service(undefined, undefined, sealedRepository());

    await expect(
      targets.create({ ...base, projectId: null, name: "billing" }),
    ).resolves.toMatchObject({ name: "billing" });
  });

  /** @scenario "a target URL that holds credentials is refused at save time" */
  it("refuses credentials inside a target URL without echoing them", async () => {
    for (const field of ["upstreamUrl", "cardUrl"] as const) {
      const error = await service()
        .create({
          ...base,
          projectId: null,
          name: "billing",
          [field]: "https://agent:hunter2@billing.acme.test/a2a",
        })
        .catch((caught: unknown) => caught);
      expect(String(error)).toContain("upstream headers");
      expect(String(error)).not.toContain("hunter2");
    }
  });

  /** @scenario "the target's saved upstream headers never follow its upstream to a new origin" */
  it("refuses to carry saved upstream headers to a new upstream origin", async () => {
    const targets = service();
    const created = await targets.create({
      ...base,
      projectId: null,
      name: "billing",
      upstreamHeaders: { "X-Token": "s3cret" },
    });
    const edit = { id: created.id, organizationId: "org_1", actorUserId: "u1" };

    for (const upstreamUrl of ["https://collector.evil.test/a2a", "http://billing.acme.test/a2a"]) {
      await expect(targets.update({ ...edit, upstreamUrl })).rejects.toThrow(
        GatewayA2aTargetHeadersNeedReplacingError,
      );
    }
    await expect(
      targets.update({ ...edit, upstreamUrl: "https://billing.acme.test/v2/a2a" }),
    ).resolves.toMatchObject({ upstreamHeaders: { "X-Token": "s3cret" } });
    await expect(
      targets.update({
        ...edit,
        upstreamUrl: "https://agents.acme.test/a2a",
        upstreamHeaders: { "X-Token": "replaced" },
      }),
    ).resolves.toMatchObject({ upstreamUrl: "https://agents.acme.test/a2a" });
  });

  /** @scenario "every A2A target write is audited without header values" */
  it("writes a gateway audit row for every write, with header names but never values", async () => {
    const rows: AppendGatewayAuditInput[] = [];
    const targets = service(undefined, {
      append: async (row) => {
        rows.push(row);
      },
    });
    const created = await targets.create({
      ...base,
      projectId: "p1",
      name: "billing",
      upstreamHeaders: { "X-Token": "s3cret" },
    });
    const ref = { id: created.id, organizationId: "org_1" };
    await targets.update({ ...ref, agentName: "Renamed", actorUserId: "u2" });
    await targets.setBlocked({ ...ref, blocked: true, blockReason: "incident", actorUserId: "u3" });
    await targets.setBlocked({ ...ref, blocked: false, blockReason: null, actorUserId: "u3" });
    await targets.archive({ ...ref, actorUserId: "u4" });

    expect(rows.map((row) => [row.action, row.actorUserId, row.targetKind, row.projectId])).toEqual(
      [
        ["gateway.a2a_target.created", "user_1", "a2a_target", "p1"],
        ["gateway.a2a_target.updated", "u2", "a2a_target", "p1"],
        ["gateway.a2a_target.blocked", "u3", "a2a_target", "p1"],
        ["gateway.a2a_target.unblocked", "u3", "a2a_target", "p1"],
        ["gateway.a2a_target.archived", "u4", "a2a_target", "p1"],
      ],
    );
    expect(rows.every((row) => row.targetId === created.id)).toBe(true);
    expect(rows[1]?.before).toMatchObject({
      agentName: "Billing agent",
      upstreamHeaderNames: ["X-Token"],
    });
    expect(rows[1]?.after).toMatchObject({ agentName: "Renamed" });
    expect(JSON.stringify(rows)).not.toContain("s3cret");
  });

  it("refuses names that cannot be a path segment", async () => {
    await expect(service().create({ ...base, projectId: null, name: "Bad/Name" })).rejects.toThrow(
      "lowercase letters",
    );
  });

  it("refuses an upstream that is not http or https", async () => {
    await expect(
      service().create({ ...base, projectId: null, name: "x", upstreamUrl: "file:///etc/passwd" }),
    ).rejects.toThrow("http or https");
  });

  it("prefers the project's target over the org-wide one and keeps the allow list", async () => {
    const targets = service();
    await targets.create({
      ...base,
      projectId: null,
      name: "billing",
      upstreamUrl: "https://org.test",
    });
    await targets.create({ ...base, projectId: null, name: "search" });
    await targets.create({
      ...base,
      projectId: "p1",
      name: "billing",
      upstreamUrl: "https://project.test",
      upstreamHeaders: { Authorization: "Bearer s3cret" },
      allowedVirtualKeyIds: ["vk_1"],
    });

    const bundle = await targets.bundleFor({
      organizationId: "org_1",
      projectId: "p1",
      virtualKeyId: "vk_1",
    });

    expect(bundle.map((t) => [t.name, t.upstream_url])).toEqual([
      ["billing", "https://project.test"],
      ["search", base.upstreamUrl],
    ]);
    expect(bundle[0]).toMatchObject({
      upstream_headers: { Authorization: "Bearer s3cret" },
      allowed_virtual_key_ids: ["vk_1"],
    });
    expect(bundle[1]?.allowed_virtual_key_ids).toBeNull();
  });

  it("ships a blocked target so the gateway refuses it with its reason", async () => {
    const targets = service();
    const created = await targets.create({ ...base, projectId: null, name: "billing" });
    await targets.update({
      id: created.id,
      organizationId: "org_1",
      blocked: true,
      blockReason: "incident",
      actorUserId: "user_1",
    });

    const [wire] = await targets.bundleFor({
      organizationId: "org_1",
      projectId: null,
      virtualKeyId: "vk_1",
    });

    expect(wire).toMatchObject({ blocked: true, block_reason: "incident" });
  });

  it("drops an archived target from the bundle and refuses to touch it again", async () => {
    const targets = service();
    const created = await targets.create({ ...base, projectId: null, name: "billing" });
    await targets.archive({ id: created.id, organizationId: "org_1", actorUserId: "u1" });

    expect(
      await targets.bundleFor({ organizationId: "org_1", projectId: null, virtualKeyId: "vk_1" }),
    ).toEqual([]);
    await expect(
      targets.archive({ id: created.id, organizationId: "org_1", actorUserId: "u1" }),
    ).rejects.toThrow(GatewayA2aTargetNotFoundError);
  });

  it("shows header names but never header values on the platform surface", async () => {
    const created = await service().create({
      ...base,
      projectId: null,
      name: "billing",
      upstreamHeaders: { Authorization: "Bearer s3cret" },
    });

    const dto = a2aTargetToDto(created);

    expect(dto.upstreamHeaderNames).toEqual(["Authorization"]);
    expect(JSON.stringify(dto)).not.toContain("s3cret");
  });

  it("carries only targets whose allow list admits the key, or that have none", async () => {
    const targets = service();
    await targets.create({ ...base, projectId: null, name: "open" });
    await targets.create({
      ...base,
      projectId: null,
      name: "mine",
      allowedVirtualKeyIds: ["vk_1"],
    });
    await targets.create({
      ...base,
      projectId: null,
      name: "theirs",
      allowedVirtualKeyIds: ["vk_2"],
    });
    const bundle = await targets.bundleFor({
      organizationId: "org_1",
      projectId: null,
      virtualKeyId: "vk_1",
    });
    expect(bundle.map((t) => t.name)).toEqual(["mine", "open"]);
  });

  it("fingerprints without unsealing headers and still moves on a header edit", async () => {
    const targets = service(undefined, undefined, sealedRepository());
    const created = await targets.create({ ...base, projectId: null, name: "billing" });
    const scope = { organizationId: "org_1", projectId: null, virtualKeyId: "vk_1" };
    const before = await targets.bundleFingerprint(scope);

    await new Promise((resolve) => setTimeout(resolve, 2));
    await targets.update({
      id: created.id,
      organizationId: "org_1",
      upstreamHeaders: { "X-Token": "rotated" },
      actorUserId: "u1",
    });
    expect(await targets.bundleFingerprint(scope)).not.toBe(before);
  });

  it("blocks a target and changes the bundle fingerprint", async () => {
    const targets = service();
    const created = await targets.create({ ...base, projectId: null, name: "billing" });
    const scope = { organizationId: "org_1", projectId: null, virtualKeyId: "vk_1" };
    const before = await targets.bundleFingerprint(scope);
    await targets.setBlocked({
      id: created.id,
      organizationId: "org_1",
      blocked: true,
      blockReason: "incident",
      actorUserId: "u1",
    });
    const [wire] = await targets.bundleFor(scope);
    expect(wire).toMatchObject({ blocked: true, block_reason: "incident" });
    expect(await targets.bundleFingerprint(scope)).not.toBe(before);
  });

  it("clears the reason when a target is unblocked", async () => {
    const targets = service();
    const created = await targets.create({ ...base, projectId: null, name: "billing" });
    await targets.setBlocked({
      id: created.id,
      organizationId: "org_1",
      blocked: true,
      blockReason: "x",
      actorUserId: "u1",
    });
    const unblocked = await targets.setBlocked({
      id: created.id,
      organizationId: "org_1",
      blocked: false,
      blockReason: "x",
      actorUserId: "u1",
    });
    expect(unblocked).toMatchObject({ blocked: false, blockReason: null });
  });

  it("appends a change event on every write so gateways refetch their bundles", async () => {
    const changeEvents = MemoryGatewayChangeEventsRepository.create();
    const targets = service(changeEvents);
    const created = await targets.create({ ...base, projectId: "p1", name: "billing" });
    await targets.setBlocked({
      id: created.id,
      organizationId: base.organizationId,
      blocked: true,
      blockReason: "incident",
      actorUserId: base.actorUserId,
    });
    await targets.archive({
      id: created.id,
      organizationId: base.organizationId,
      actorUserId: base.actorUserId,
    });

    const { events } = await changeEvents.since(base.organizationId, 0n);
    expect(events.map((event) => [event.kind, event.projectId])).toEqual([
      ["A2A_TARGET_CREATED", "p1"],
      ["A2A_TARGET_UPDATED", "p1"],
      ["A2A_TARGET_DELETED", "p1"],
    ]);
  });

  it("stores one target when two creates with the same name race", async () => {
    const targets = service();
    const results = await Promise.allSettled([
      targets.create({ ...base, projectId: null, name: "billing" }),
      targets.create({ ...base, projectId: null, name: "billing" }),
    ]);

    expect(results.map((result) => result.status).toSorted()).toEqual(["fulfilled", "rejected"]);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: { code: "gateway_a2a_target_name_taken" },
    });
  });
});

describe("MemoryGatewayA2aTargetRepository", () => {
  it("keeps an archive that lands while an update is in flight", async () => {
    const repository = MemoryGatewayA2aTargetRepository.create();
    const created = await repository.create({ ...base, projectId: null, name: "billing" });
    const target = { id: created.id, organizationId: base.organizationId };

    await Promise.all([
      repository.update({ ...target, agentName: "Renamed", actorUserId: base.actorUserId }),
      repository.archive(target),
    ]);

    expect(await repository.findById(target)).toBeNull();
    expect(await repository.findAll(base.organizationId)).toEqual([]);
  });
});
