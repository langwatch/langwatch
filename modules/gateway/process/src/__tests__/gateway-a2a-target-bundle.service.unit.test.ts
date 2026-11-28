/** What the A2A target registry hands a gateway: the bundle's targets and its fingerprint. */
import { describe, expect, it } from "vitest";

import { a2aTargetToDto } from "../rules/gateway-a2a-target.rules.ts";
import {
  a2aTargetBase as base,
  a2aTargetService as service,
  sealedA2aTargetRepository,
} from "./support/a2a-target.fixture.ts";

describe("GatewayA2aTargetService bundle", () => {
  /** @scenario "targets are registered from the control plane" */
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
    ).rejects.toMatchObject({ code: "gateway_a2a_target_not_found" });
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
    const targets = service({ repository: sealedA2aTargetRepository() });
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
});
