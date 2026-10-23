/**
 * The API key module's half of signed-calls.feature (ADR-185 §4): the answer span admission marks
 * from, and the failures the keys list counts. The trace module's half, a span marked only on a
 * `verified` answer, is record-span.signed-calls.unit.test.ts.
 */
import { createHmac } from "node:crypto";

import {
  type IssuedSigningKey,
  SIGNING_KEY_ROTATION_OVERLAP_MS,
} from "@langwatch/api-key-contract";
import { braidSignatureMessage } from "@langwatch/api-key-contract/signing-key-wire-format";
import { fromDate, type Instant } from "@langwatch/time";
import { beforeEach, describe, expect, it } from "vitest";

import { MemorySigningKeyUsageRepository } from "../../repositories/memory/memory.signing-key-usage.repository.ts";
import { MemorySigningKeyRepository } from "../../repositories/memory/memory.signing-key.repository.ts";
import { BraidSignatureVerificationService } from "../braid-signature-verification.service.ts";
import { SigningKeyService } from "../signing-key.service.ts";

const ORGANIZATION = "org_braids";
const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
const MINUTE_MS = 60_000;
/** What every SDK's called service puts on its spans for orchestrator "web" in TRACE_ID, signed
 *  with the SDKs' test key `lwsk_testkid_testsecret` (pinned in each SDK's braid signing test). */
const SDK_CALL_SIGNATURE =
  "eyJ2IjoxLCJraWQiOiJ0ZXN0a2lkIiwia2V5cyI6WyJvcmNoZXN0cmF0b3IiXSwic2lnIjoiSjg2RU1MejJXUVZlZkpLN1BfN1R2UmEtdzRvR000TG96bjhlZTNMd0kyRSJ9";

/** Signs as the SDK does, wire format v1: an HMAC under the whole issued secret. */
function sign({
  issued,
  entries,
}: {
  issued: IssuedSigningKey;
  entries: Record<string, string>;
}): string {
  const message = braidSignatureMessage({ traceId: TRACE_ID, entries });
  if (message.kind !== "message") throw new Error("entries the wire format never signs");
  const envelope = {
    v: 1,
    kid: issued.signingKey.publicId,
    keys: Object.keys(entries).toSorted(),
    sig: createHmac("sha256", issued.secret).update(message.text, "utf8").digest("base64url"),
  };
  return Buffer.from(JSON.stringify(envelope)).toString("base64url");
}

describe("the API key module's answer to a span's signature", () => {
  let now: Instant;
  let signingKeys: SigningKeyService;
  let signatures: BraidSignatureVerificationService;

  beforeEach(() => {
    now = fromDate(new Date(Date.UTC(2026, 9, 21, 12)));
    const keys = MemorySigningKeyRepository.create();
    const usage = MemorySigningKeyUsageRepository.create();
    signatures = BraidSignatureVerificationService.create({ keys, usage, now: () => now });
    signingKeys = SigningKeyService.create({
      keys,
      usage,
      projects: { getOrganizationId: async () => ORGANIZATION },
      braidSignatures: signatures,
      now: () => now,
    });
  });

  const issue = () =>
    signingKeys.create({ projectId: "orchestrator", name: "Production", userId: "ana" });

  /** What "specialists" sends: the entry orchestrator "web" and the signature it carries. */
  const verify = (signature: string) =>
    signatures.verify({
      organizationId: ORGANIZATION,
      traceId: TRACE_ID,
      entries: { orchestrator: "web" },
      signature,
    });

  describe("given a signature that does not match the entry the span carries", () => {
    /** @scenario "A span whose signature does not check out is stored unmarked and counted" */
    it("answers failed, naming the key, and counts the failure against that key", async () => {
      const issued = await issue();

      const verdict = await verify(sign({ issued, entries: { orchestrator: "app" } }));
      await signatures.flush();

      expect(verdict).toEqual({
        outcome: "failed",
        reason: "bad_signature",
        publicId: issued.signingKey.publicId,
      });
      const [listed] = await signingKeys.find({ projectId: "orchestrator" });
      expect(listed).toMatchObject({ id: issued.signingKey.id, passed24h: 0, failed24h: 1 });
    });
  });

  describe("given the signature each SDK's called service copies onto its spans", () => {
    /** @scenario "The <language> SDK signs the named entries and copies them onto spans" */
    it("verifies it as orchestrator's, for the entry it covers", async () => {
      const keys = MemorySigningKeyRepository.create();
      await keys.create({
        id: "key_sdk",
        organizationId: ORGANIZATION,
        projectId: "orchestrator",
        name: "SDK test key",
        publicId: "testkid",
        secret: "testsecret",
        createdByUserId: "ana",
      });
      const sdkSignatures = BraidSignatureVerificationService.create({
        keys,
        usage: MemorySigningKeyUsageRepository.create(),
        now: () => now,
      });

      await expect(
        sdkSignatures.verify({
          organizationId: ORGANIZATION,
          traceId: TRACE_ID,
          entries: { orchestrator: "web" },
          signature: SDK_CALL_SIGNATURE,
        }),
      ).resolves.toEqual({
        outcome: "verified",
        signingProjectId: "orchestrator",
        keys: ["orchestrator"],
      });
    });
  });

  describe("given orchestrator rotated the key a span was signed with", () => {
    /** @scenario "A rotated key keeps verifying for seven days" */
    it("verifies the old key's signature within seven days of the rotation, and not after", async () => {
      const issued = await issue();
      const signedWithOld = sign({ issued, entries: { orchestrator: "web" } });
      await signingKeys.rotate({
        projectId: "orchestrator",
        keyId: issued.signingKey.id,
        userId: "ana",
      });

      now = now.add({ milliseconds: SIGNING_KEY_ROTATION_OVERLAP_MS - MINUTE_MS });
      await expect(verify(signedWithOld)).resolves.toEqual({
        outcome: "verified",
        signingProjectId: "orchestrator",
        keys: ["orchestrator"],
      });

      now = now.add({ milliseconds: 2 * MINUTE_MS });
      await expect(verify(signedWithOld)).resolves.toMatchObject({
        outcome: "failed",
        reason: "expired",
      });
    });
  });
});
