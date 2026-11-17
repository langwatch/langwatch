import {
  GatewayA2aTargetNameTakenError,
  GatewayA2aTargetNotFoundError,
} from "@langwatch/gateway-contract";
import { describe, expect, it } from "vitest";

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

function service(changeEvents = MemoryGatewayChangeEventsRepository.create()) {
  return GatewayA2aTargetService.create({
    repository: MemoryGatewayA2aTargetRepository.create(),
    changeEvents,
  });
}

describe("GatewayA2aTargetService", () => {
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
    await targets.archive({ id: created.id, organizationId: "org_1" });

    expect(
      await targets.bundleFor({ organizationId: "org_1", projectId: null, virtualKeyId: "vk_1" }),
    ).toEqual([]);
    await expect(targets.archive({ id: created.id, organizationId: "org_1" })).rejects.toThrow(
      GatewayA2aTargetNotFoundError,
    );
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
    await targets.archive({ id: created.id, organizationId: base.organizationId });

    const { events } = await changeEvents.since(base.organizationId, 0n);
    expect(events.map((event) => [event.kind, event.projectId])).toEqual([
      ["A2A_TARGET_CREATED", "p1"],
      ["A2A_TARGET_UPDATED", "p1"],
      ["A2A_TARGET_DELETED", "p1"],
    ]);
  });
});
