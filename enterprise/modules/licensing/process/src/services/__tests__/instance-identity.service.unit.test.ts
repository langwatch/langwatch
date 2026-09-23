/**
 * The identity a self-hosted install presents: one per install, minted once,
 * carrying nothing about the customer.
 * @see specs/self-hosting/connected-services/license-sync.feature
 */
import { Temporal, type Instant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryInstanceIdentityRepository } from "../../repositories/memory/memory.instance-identity.repository.ts";
import { InstanceIdentityService } from "../instance-identity.service.ts";

const NOW: Instant = Temporal.Instant.from("2026-01-01T00:00:00.000Z");

function identity({ override, ids = ["instance-1"] }: { override?: string; ids?: string[] } = {}) {
  const minted = [...ids];
  const repository = MemoryInstanceIdentityRepository.create({ now: () => NOW });
  return {
    repository,
    service: InstanceIdentityService.create({
      repository,
      newInstanceId: () => minted.shift() ?? "exhausted",
      ...(override ? { instanceIdOverride: override } : {}),
    }),
  };
}

describe("the identity a self-hosted install presents", () => {
  /** @scenario "The instance identity names the install, not an organization" */
  it("answers one identity however many organizations the install carries", async () => {
    const { service } = identity();

    const first = await service.getInstanceId();
    const second = await service.getInstanceId();

    expect(first).toBe("instance-1");
    expect(second).toBe(first);
  });

  /** @scenario "Two processes minting the identity at once end with one identity" */
  it("leaves one identity when two services mint against the same row", async () => {
    const repository = MemoryInstanceIdentityRepository.create({ now: () => NOW });
    const first = InstanceIdentityService.create({
      repository,
      newInstanceId: () => "instance-a",
    });
    const second = InstanceIdentityService.create({
      repository,
      newInstanceId: () => "instance-b",
    });

    const [a, b] = await Promise.all([first.getInstanceId(), second.getInstanceId()]);

    expect(a).toBe(b);
    expect((await repository.findRow())?.instanceId).toBe(a);
  });

  /** @scenario "An operator can name the identity this install presents" */
  it("presents the identity the deployment configuration names, minting none", async () => {
    const { service, repository } = identity({ override: "named-by-the-operator" });

    expect(await service.getInstanceId()).toBe("named-by-the-operator");
    expect(await repository.findRow()).toBeNull();
  });

  it("reads without minting, so a reporting path writes nothing", async () => {
    const { service, repository } = identity();

    expect(await service.findIdentity()).toEqual([]);
    expect(await repository.findRow()).toBeNull();
  });
});

describe("what the install remembers about its own reporting", () => {
  /** @scenario "A refused usage report is recorded rather than logged and forgotten" */
  it("records the refusal of a report and keeps the last time one landed", async () => {
    const { service, repository } = identity();
    await service.getInstanceId();

    await service.recordReport({ error: null, at: NOW });
    const later = NOW.add({ hours: 24 });
    await service.recordReport({ error: "connect_unreachable", at: later });

    const [row] = await service.findIdentity();
    expect(row?.lastReportAt?.toString()).toBe(NOW.toString());
    expect(row?.lastReportError).toBe("connect_unreachable");
    expect((await repository.findRow())?.lastReportError).toBe("connect_unreachable");
  });

  it("mints the identity when an administrator dismisses the startup notice", async () => {
    const { service, repository } = identity();

    await service.acknowledgeStartupNotice(3);

    expect((await repository.findRow())?.startupNoticeAcknowledgedSchemaVersion).toBe(3);
  });
});
