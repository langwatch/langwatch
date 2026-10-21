/**
 * Verifying a braid signature against the SDK's pinned vector
 * (.claude/handoffs/braids-a4-sdk-signing.md), and the ways it fails.
 * @see modules/api-key/specs/signing-keys.feature
 */
import { fromDate, type Instant } from "@langwatch/time";
import { beforeEach, describe, expect, it } from "vitest";

import { MemorySigningKeyUsageRepository } from "../../repositories/memory/memory.signing-key-usage.repository.ts";
import { MemorySigningKeyRepository } from "../../repositories/memory/memory.signing-key.repository.ts";
import { BraidSignatureVerificationService } from "../braid-signature-verification.service.ts";

const ORGANIZATION = "org_braids";
const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
const ENTRIES = { orchestrator: "web", team: "a" };
const SIGNATURE =
  "eyJ2IjoxLCJraWQiOiJ0ZXN0a2lkIiwia2V5cyI6WyJvcmNoZXN0cmF0b3IiLCJ0ZWFtIl0sInNpZyI6IjFNWGtzUVIzc25vdVBZV0Z4TzVDZnlyRzY2WUQ1MzlhbmNlbWVRaG9VazQifQ";

function flipped(signature: string): string {
  const envelope = JSON.parse(atob(signature.replaceAll("-", "+").replaceAll("_", "/"))) as {
    sig: string;
  };
  const last = envelope.sig.at(-2) === "A" ? "B" : "A";
  envelope.sig = `${envelope.sig.slice(0, -2)}${last}${envelope.sig.at(-1)}`;
  return btoa(JSON.stringify(envelope))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

describe("verifying a braid signature", () => {
  let keys: MemorySigningKeyRepository;
  let usage: MemorySigningKeyUsageRepository;
  let now: Instant;
  let service: BraidSignatureVerificationService;

  beforeEach(async () => {
    keys = MemorySigningKeyRepository.create();
    usage = MemorySigningKeyUsageRepository.create();
    now = fromDate(new Date(Date.UTC(2026, 9, 21, 12)));
    service = BraidSignatureVerificationService.create({ keys, usage, now: () => now });
    await keys.create({
      id: "key_1",
      organizationId: ORGANIZATION,
      projectId: "orchestrator",
      name: "Production",
      publicId: "testkid",
      secret: "testsecret",
      createdByUserId: "ana",
    });
  });

  const verify = (overrides: Partial<Parameters<typeof service.verify>[0]> = {}) =>
    service.verify({
      organizationId: ORGANIZATION,
      traceId: TRACE_ID,
      entries: ENTRIES,
      signature: SIGNATURE,
      ...overrides,
    });

  it("verifies the SDK's pinned vector for the signing project", async () => {
    await expect(verify()).resolves.toEqual({
      outcome: "verified",
      signingProjectId: "orchestrator",
      keys: ["orchestrator", "team"],
    });
  });

  it("fails a signature with one byte flipped", async () => {
    await expect(verify({ signature: flipped(SIGNATURE) })).resolves.toMatchObject({
      outcome: "failed",
      reason: "bad_signature",
    });
  });

  it("fails the same signature carried into another trace", async () => {
    await expect(verify({ traceId: "1bf7651916cd43dd8448eb211c80319c" })).resolves.toMatchObject({
      outcome: "failed",
      reason: "bad_signature",
    });
  });

  it("fails a signed value holding a line break", async () => {
    await expect(
      verify({ entries: { orchestrator: "web\nteam=a", team: "a" } }),
    ).resolves.toMatchObject({ outcome: "failed", reason: "malformed" });
  });

  it("fails when a signed entry is missing from the span", async () => {
    await expect(verify({ entries: { orchestrator: "web" } })).resolves.toMatchObject({
      outcome: "failed",
      reason: "malformed",
    });
  });

  it("fails a key looked up from another organisation as unknown", async () => {
    await expect(verify({ organizationId: "org_other" })).resolves.toEqual({
      outcome: "failed",
      reason: "unknown_key",
      publicId: "testkid",
    });
  });

  it("fails a revoked key once this server forgets the held lookup", async () => {
    await verify();
    await keys.revoke({
      organizationId: ORGANIZATION,
      projectId: "orchestrator",
      id: "key_1",
      revokedAt: now,
    });
    service.forget({ organizationId: ORGANIZATION, publicId: "testkid" });

    await expect(verify()).resolves.toMatchObject({ outcome: "failed", reason: "revoked" });
  });

  /** @scenario "Revoking a key ends it at once" */
  it("stops verifying a revoked key within the minute the lookup is held", async () => {
    await verify();
    await keys.revoke({
      organizationId: ORGANIZATION,
      projectId: "orchestrator",
      id: "key_1",
      revokedAt: now,
    });
    now = now.add({ milliseconds: 60_000 });

    await expect(verify()).resolves.toMatchObject({ outcome: "failed", reason: "revoked" });
  });

  it("fails a rotated key once its overlap has ended", async () => {
    await keys.markRotated({
      organizationId: ORGANIZATION,
      projectId: "orchestrator",
      id: "key_1",
      rotatedAt: now,
      verifiesUntil: now.add({ milliseconds: 1_000 }),
    });
    now = now.add({ milliseconds: 61_000 });

    await expect(verify()).resolves.toMatchObject({ outcome: "failed", reason: "expired" });
  });

  it("answers unavailable when the key cannot be looked up", async () => {
    const broken = BraidSignatureVerificationService.create({
      keys: {
        findCredentials: () => Promise.reject(new Error("database down")),
        markUsed: () => Promise.resolve(),
      },
      usage,
    });

    await expect(
      broken.verify({
        organizationId: ORGANIZATION,
        traceId: TRACE_ID,
        entries: ENTRIES,
        signature: SIGNATURE,
      }),
    ).resolves.toEqual({ outcome: "unavailable" });
  });

  it("counts passed and failed signatures and the last use in one write per flush", async () => {
    await verify();
    await verify();
    await verify({ traceId: "1bf7651916cd43dd8448eb211c80319c" });
    await service.flush();

    const hour = Math.floor(now.epochMilliseconds / 3_600_000);
    await expect(
      usage.findTotals({ keyIds: ["key_1"], fromHour: hour - 23, toHour: hour }),
    ).resolves.toEqual([{ keyId: "key_1", passed: 2, failed: 1 }]);
    const [row] = await keys.findByProject({
      organizationId: ORGANIZATION,
      projectId: "orchestrator",
    });
    expect(row?.lastUsedAt?.epochMilliseconds).toBe(now.epochMilliseconds);
  });
});
