/**
 * Issuing, rotating, revoking and listing a project's signing keys over the memory tier.
 * @see modules/api-key/specs/signing-keys.feature
 */
import { fromDate, type Instant, toDate } from "@langwatch/time";
import { beforeEach, describe, expect, it } from "vitest";

import { MemorySigningKeyUsageRepository } from "../../repositories/memory/memory.signing-key-usage.repository.ts";
import { MemorySigningKeyRepository } from "../../repositories/memory/memory.signing-key.repository.ts";
import { SIGNING_KEY_USAGE_HOUR_MS } from "../../rules/signing-key.rules.ts";
import { BraidSignatureVerificationService } from "../braid-signature-verification.service.ts";
import { SigningKeyService } from "../signing-key.service.ts";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ORGANIZATION_OF: Record<string, string> = { orchestrator: "org_a", elsewhere: "org_a" };

describe("managing a project's signing keys", () => {
  let now: Instant;
  let service: SigningKeyService;
  let organizationLookups: string[];
  let keys: MemorySigningKeyRepository;
  let usage: MemorySigningKeyUsageRepository;

  beforeEach(() => {
    now = fromDate(new Date(Date.UTC(2026, 9, 21, 12)));
    organizationLookups = [];
    keys = MemorySigningKeyRepository.create();
    usage = MemorySigningKeyUsageRepository.create();
    service = SigningKeyService.create({
      keys,
      usage,
      // The only thing this service asks of the project: its organisation, never its API key.
      projects: {
        getOrganizationId: async (projectId: string) => {
          organizationLookups.push(projectId);
          return ORGANIZATION_OF[projectId]!;
        },
      },
      braidSignatures: BraidSignatureVerificationService.create({ keys, usage }),
      now: () => now,
    });
  });

  /** @scenario "No read returns a signing key's secret" */
  it("answers the secret from create alone, never from the list", async () => {
    const issued = await service.create({
      projectId: "orchestrator",
      name: "Production",
      userId: "ana",
    });
    const listed = await service.find({ projectId: "orchestrator" });

    expect(issued.secret).toMatch(/^lwsk_[A-Za-z0-9]{16}_[A-Za-z0-9]{40}$/);
    expect(issued.secret).toContain(`lwsk_${issued.signingKey.publicId}_`);
    expect(listed).toEqual([issued.signingKey]);
    expect(JSON.stringify(listed)).not.toContain(issued.secret.split("_")[2]);
  });

  /** @scenario "A signing key is never the project's API key" */
  it("issues fresh random material asking the project only for its organisation", async () => {
    const first = await service.create({ projectId: "orchestrator", name: "One", userId: "ana" });
    const second = await service.create({ projectId: "orchestrator", name: "Two", userId: "ana" });

    expect(first.secret).not.toBe(second.secret);
    expect(first.signingKey.publicId).not.toBe(second.signingKey.publicId);
    expect(organizationLookups).toEqual(["orchestrator", "orchestrator"]);
  });

  /** @scenario "Rotating a key keeps the old one verifying for seven days" */
  it("rotates a key into a new secret and keeps the old one verifying for seven days", async () => {
    const issued = await service.create({
      projectId: "orchestrator",
      name: "Production",
      userId: "ana",
    });
    const rotated = await service.rotate({
      projectId: "orchestrator",
      keyId: issued.signingKey.id,
      userId: "ana",
    });
    const listed = await service.find({ projectId: "orchestrator" });
    const old = listed.find((key) => key.id === issued.signingKey.id);

    expect(rotated.secret).not.toBe(issued.secret);
    expect(rotated.signingKey).toMatchObject({ name: "Production", status: "active" });
    expect(old).toMatchObject({ status: "verifying", revokedAt: null });
    expect(old?.verifiesUntil?.getTime()).toBe(now.epochMilliseconds + SEVEN_DAYS_MS);
  });

  it("issues one key when the same key is rotated twice at once, refusing the other", async () => {
    const issued = await service.create({
      projectId: "orchestrator",
      name: "Production",
      userId: "ana",
    });
    const rotation = { projectId: "orchestrator", keyId: issued.signingKey.id, userId: "ana" };

    const outcomes = await Promise.allSettled([service.rotate(rotation), service.rotate(rotation)]);
    const listed = await service.find({ projectId: "orchestrator" });

    expect(outcomes.map((outcome) => outcome.status).toSorted()).toEqual(["fulfilled", "rejected"]);
    expect(outcomes.find((outcome) => outcome.status === "rejected")).toMatchObject({
      reason: { code: "not_found" },
    });
    expect(listed.filter((key) => key.status === "active")).toHaveLength(1);
  });

  /** @scenario "A project signs its calls with its live key used last" */
  it("names the live key used last, and nothing for a project with only revoked keys", async () => {
    const make = (name: string) =>
      service.create({ projectId: "orchestrator", name, userId: "ana" });
    const revoked = await make("Old");
    await make("Unused");
    const used = await make("Production");
    await keys.markUsed({ organizationId: "org_a", ids: [used.signingKey.id], at: now });
    await service.revoke({ projectId: "orchestrator", keyId: revoked.signingKey.id });

    const signing = await service.findProjectSigning({ projectId: "orchestrator" });
    const onlyRevoked = await service.create({
      projectId: "elsewhere",
      name: "Gone",
      userId: "ana",
    });
    await service.revoke({ projectId: "elsewhere", keyId: onlyRevoked.signingKey.id });

    expect(signing).toEqual({ keyName: "Production", lastUsedAt: toDate(now) });
    expect(await service.findProjectSigning({ projectId: "elsewhere" })).toBeNull();
  });

  /** @scenario "Revoking a key ends it at once" */
  it("lists a revoked key as revoked", async () => {
    const issued = await service.create({
      projectId: "orchestrator",
      name: "Production",
      userId: "ana",
    });
    const revoked = await service.revoke({
      projectId: "orchestrator",
      keyId: issued.signingKey.id,
    });

    expect(revoked).toMatchObject({ status: "revoked" });
    expect(revoked.revokedAt?.getTime()).toBe(now.epochMilliseconds);
  });

  it("refuses a key of another project as not found", async () => {
    const issued = await service.create({
      projectId: "orchestrator",
      name: "Production",
      userId: "ana",
    });

    await expect(
      service.revoke({ projectId: "elsewhere", keyId: issued.signingKey.id }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      service.rotate({ projectId: "elsewhere", keyId: issued.signingKey.id, userId: "ana" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
  /** @scenario "Each key shows its status and its signed spans over the last 24 hours" */
  it("lists a key's status, creation, last use and the last 24 hours of signed spans", async () => {
    const issued = await service.create({
      projectId: "orchestrator",
      name: "Production",
      userId: "ana",
    });
    const id = issued.signingKey.id;
    const hour = Math.floor(now.epochMilliseconds / SIGNING_KEY_USAGE_HOUR_MS);
    await usage.add({
      usage: [
        { keyId: id, hour, passed: 5, failed: 2 },
        { keyId: id, hour: hour - 23, passed: 1, failed: 0 },
        { keyId: id, hour: hour - 24, passed: 100, failed: 100 },
      ],
    });
    await keys.markUsed({ organizationId: "org_a", ids: [id], at: now });

    const [listed] = await service.find({ projectId: "orchestrator" });

    expect(listed).toMatchObject({ status: "active", passed24h: 6, failed24h: 2 });
    expect(listed?.createdAt).toEqual(issued.signingKey.createdAt);
    expect(listed?.lastUsedAt?.getTime()).toBe(now.epochMilliseconds);
  });
});
