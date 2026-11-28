/**
 * Verifying a braid signature against the SDK's pinned vector
 * (ADR-201 section 4, signed calls), and the ways it fails.
 * @see modules/api-key/specs/signing-keys.feature
 */
import { SIGNING_KEY_LOOKUP_CACHE_MS } from "@langwatch/api-key-contract";
import { fromDate, type Instant } from "@langwatch/time";
import { beforeEach, describe, expect, it } from "vitest";

import { MemorySigningKeyUsageRepository } from "../../repositories/memory/memory.signing-key-usage.repository.ts";
import { MemorySigningKeyRepository } from "../../repositories/memory/memory.signing-key.repository.ts";
import {
  BraidSignatureVerificationService,
  SIGNING_KEY_UNKNOWN_REREAD_MS,
} from "../braid-signature-verification.service.ts";

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
    service.forget({ organizationId: ORGANIZATION });

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

  describe("when spans carry key ids nobody holds", () => {
    /** @scenario "Spans signed with unknown key ids cost no database read each" */
    it("reads the organisation's keys once, not once per unknown key id", async () => {
      let reads = 0;
      const counted = BraidSignatureVerificationService.create({
        keys: {
          findCredentials: (input) => {
            reads += 1;
            return keys.findCredentials(input);
          },
          markUsed: (input) => keys.markUsed(input),
        },
        usage,
        now: () => now,
      });
      const verifyWith = (signature: string) =>
        counted.verify({
          organizationId: ORGANIZATION,
          traceId: TRACE_ID,
          entries: ENTRIES,
          signature,
        });
      const unknown = (kid: string) =>
        btoa(JSON.stringify({ ...JSON.parse(atob(SIGNATURE)), kid })).replace(/=+$/, "");

      const verdicts = await Promise.all(
        Array.from({ length: 200 }, (_, n) => verifyWith(unknown(`random${n}`))),
      );

      expect(verdicts.every((verdict) => verdict.outcome === "failed")).toBe(true);
      expect(verdicts[0]).toMatchObject({ reason: "unknown_key" });
      expect(reads).toBe(1);
      await expect(verifyWith(SIGNATURE)).resolves.toMatchObject({ outcome: "verified" });
      expect(reads).toBe(1);
    });

    it("finds a key created since the organisation's keys were read once the re-read wait passes", async () => {
      await verify();
      await keys.create({
        id: "key_2",
        organizationId: ORGANIZATION,
        projectId: "orchestrator",
        name: "Second",
        publicId: "newkid",
        secret: "newsecret",
        createdByUserId: "ana",
      });
      const signedByNew = btoa(
        JSON.stringify({ ...JSON.parse(atob(SIGNATURE)), kid: "newkid" }),
      ).replace(/=+$/, "");
      now = now.add({ milliseconds: SIGNING_KEY_UNKNOWN_REREAD_MS });

      await expect(verify({ signature: signedByNew })).resolves.toMatchObject({
        reason: "bad_signature",
        publicId: "newkid",
      });
    });
  });

  describe("when an early re-read for an unknown key id fails", () => {
    /** @scenario "A failed early re-read keeps the keys already held verifying" */
    it("keeps verifying the held keys until their own window ends", async () => {
      let failing = false;
      const flaky = BraidSignatureVerificationService.create({
        keys: {
          findCredentials: (input) =>
            failing ? Promise.reject(new Error("database down")) : keys.findCredentials(input),
          markUsed: (input) => keys.markUsed(input),
        },
        usage,
        now: () => now,
      });
      const verifyWith = (signature: string) =>
        flaky.verify({
          organizationId: ORGANIZATION,
          traceId: TRACE_ID,
          entries: ENTRIES,
          signature,
        });
      await expect(verifyWith(SIGNATURE)).resolves.toMatchObject({ outcome: "verified" });
      failing = true;
      now = now.add({ milliseconds: SIGNING_KEY_UNKNOWN_REREAD_MS });
      const unknown = btoa(JSON.stringify({ ...JSON.parse(atob(SIGNATURE)), kid: "newkid" }));

      const [early, held] = await Promise.all([
        verifyWith(unknown.replace(/=+$/, "")),
        verifyWith(SIGNATURE),
      ]);
      const after = await verifyWith(SIGNATURE);

      expect(early).toEqual({ outcome: "unavailable" });
      expect(held).toMatchObject({ outcome: "verified" });
      expect(after).toMatchObject({ outcome: "verified" });
      now = now.add({ milliseconds: SIGNING_KEY_LOOKUP_CACHE_MS });
      await expect(verifyWith(SIGNATURE)).resolves.toEqual({ outcome: "unavailable" });
    });
  });

  describe("when one key's stored secret will not open", () => {
    /** @scenario "One signing key whose secret will not open leaves the others verifying" */
    it("answers unavailable for that key alone and verifies the others", async () => {
      const unreadable = BraidSignatureVerificationService.create({
        keys: {
          findCredentials: async (input) => [
            ...(await keys.findCredentials(input)),
            {
              id: "key_broken",
              projectId: "orchestrator",
              publicId: "brokenkid",
              secret: null,
              unreadable: true,
              verifiesUntil: null,
              revokedAt: null,
            },
          ],
          markUsed: (input) => keys.markUsed(input),
        },
        usage,
        now: () => now,
      });
      const verifyWith = (signature: string) =>
        unreadable.verify({
          organizationId: ORGANIZATION,
          traceId: TRACE_ID,
          entries: ENTRIES,
          signature,
        });
      const broken = btoa(JSON.stringify({ ...JSON.parse(atob(SIGNATURE)), kid: "brokenkid" }));

      await expect(verifyWith(broken.replace(/=+$/, ""))).resolves.toEqual({
        outcome: "unavailable",
      });
      await expect(verifyWith(SIGNATURE)).resolves.toMatchObject({ outcome: "verified" });
    });
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
