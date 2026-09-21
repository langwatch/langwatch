/** @vitest-environment node */

import { describe, expect, it, vi } from "vitest";

import type { SsoDomainProofMail } from "../../app/identity.members.ts";
import {
  SsoDomainProofNotificationService,
  UnaddressedSsoDomainProofNotifications,
  type SsoDomainProofAudience,
} from "../sso-domain-proof-notification.service.ts";

const ORG = "org_acme";
const CONNECTION = "ssoc_1";
const DOMAIN = "acme.example";
const GRACE_ENDS_AT = 1_756_172_800_000;

const WAVERING = {
  connectionId: CONNECTION,
  organizationId: ORG,
  domain: DOMAIN,
  graceEndsAtMs: GRACE_ENDS_AT,
};

function audience() {
  return {
    findAdminEmails: vi.fn<SsoDomainProofAudience["findAdminEmails"]>(async () => [
      "ana@acme.example",
      "bo@acme.example",
    ]),
    tryFindOrganizationName: vi.fn<SsoDomainProofAudience["tryFindOrganizationName"]>(
      async () => "Acme Corp",
    ),
  };
}

function mail() {
  return {
    sendProofWavering: vi.fn<SsoDomainProofMail["sendProofWavering"]>(async () => undefined),
    sendProofLapsed: vi.fn<SsoDomainProofMail["sendProofLapsed"]>(async () => undefined),
  };
}

describe("who is told a domain's proof went missing", () => {
  describe("given the record has just gone", () => {
    it("tells every administrator what to publish, where it goes, and the deadline", async () => {
      const sent = mail();
      const service = SsoDomainProofNotificationService.create({
        audience: audience(),
        mail: sent,
      });

      await service.proofWavering(WAVERING);

      expect(sent.sendProofWavering).toHaveBeenCalledTimes(2);
      expect(sent.sendProofWavering).toHaveBeenCalledWith({
        adminEmail: "ana@acme.example",
        organizationName: "Acme Corp",
        domain: DOMAIN,
        record: {
          recordType: "TXT",
          recordName: `_langwatch-verification.${DOMAIN}`,
          recordLabel: "_langwatch-verification",
        },
        graceEndsAtMs: GRACE_ENDS_AT,
      });
    });

    it("carries no token value, because only a fingerprint of it was ever kept", async () => {
      const sent = mail();
      const service = SsoDomainProofNotificationService.create({
        audience: audience(),
        mail: sent,
      });

      await service.proofWavering(WAVERING);

      const input = sent.sendProofWavering.mock.calls[0]?.[0] ?? {};
      expect(Object.keys(input).toSorted()).toEqual([
        "adminEmail",
        "domain",
        "graceEndsAtMs",
        "organizationName",
        "record",
      ]);
    });

    it("keeps telling the rest when one address bounces", async () => {
      const sent = mail();
      sent.sendProofWavering.mockRejectedValueOnce(new Error("mailbox full"));
      const service = SsoDomainProofNotificationService.create({
        audience: audience(),
        mail: sent,
      });

      await expect(service.proofWavering(WAVERING)).resolves.toBeUndefined();

      expect(sent.sendProofWavering).toHaveBeenCalledTimes(2);
    });

    it("names the organization something when its row no longer does", async () => {
      const sent = mail();
      const reads = audience();
      reads.tryFindOrganizationName.mockResolvedValue(null);
      const service = SsoDomainProofNotificationService.create({ audience: reads, mail: sent });

      await service.proofWavering(WAVERING);

      expect(sent.sendProofWavering).toHaveBeenCalledWith(
        expect.objectContaining({ organizationName: "your organization" }),
      );
    });

    it("sends nothing at all when the organization has no administrator left", async () => {
      const sent = mail();
      const reads = audience();
      reads.findAdminEmails.mockResolvedValue([]);
      const service = SsoDomainProofNotificationService.create({ audience: reads, mail: sent });

      await service.proofWavering(WAVERING);

      expect(sent.sendProofWavering).not.toHaveBeenCalled();
    });
  });

  describe("given the grace ran out", () => {
    it("sends the second mail to every administrator, with the record still named", async () => {
      const sent = mail();
      const service = SsoDomainProofNotificationService.create({
        audience: audience(),
        mail: sent,
      });

      await service.proofLapsed({
        connectionId: CONNECTION,
        organizationId: ORG,
        domain: DOMAIN,
      });

      expect(sent.sendProofLapsed).toHaveBeenCalledTimes(2);
      expect(sent.sendProofLapsed).toHaveBeenCalledWith(
        expect.objectContaining({
          adminEmail: "bo@acme.example",
          domain: DOMAIN,
          record: expect.objectContaining({ recordName: `_langwatch-verification.${DOMAIN}` }),
        }),
      );
      expect(sent.sendProofWavering).not.toHaveBeenCalled();
    });
  });

  describe("given the process composed no mail gateway", () => {
    it("lets both notices pass rather than retrying an intent nothing can satisfy", async () => {
      const unaddressed = UnaddressedSsoDomainProofNotifications.create();

      await expect(unaddressed.proofWavering(WAVERING)).resolves.toBeUndefined();
      await expect(
        unaddressed.proofLapsed({
          connectionId: CONNECTION,
          organizationId: ORG,
          domain: DOMAIN,
        }),
      ).resolves.toBeUndefined();
    });
  });
});
