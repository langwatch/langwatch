/** @vitest-environment node */

import { OrganizationNotFoundError } from "@langwatch/organization-contract";
import { describe, expect, it, vi } from "vitest";

import type { SsoDomainProofMail } from "../../channels/sso-domain-proof-mail.channel.ts";
import {
  SsoDomainProofNotificationService,
  UnaddressedSsoDomainProofNotifications,
  type SsoDomainProofAudience,
} from "../sso-domain-proof-notification.service.ts";

const ORG = "org_acme";
const CONNECTION = "ssoc_1";
const DOMAIN = "acme.example";
const GRACE_ENDS_AT = 1_756_172_800_000;

const NOTICE = "sso-domain-proof:wavering:sso_conn_1:acme.example:1756000000000";

const WAVERING = {
  notificationKey: NOTICE,
  connectionId: CONNECTION,
  organizationId: ORG,
  domain: DOMAIN,
  graceEndsAtMs: GRACE_ENDS_AT,
};

const LAPSED = {
  notificationKey: "sso-domain-proof:lapsed:sso_conn_1:acme.example:1756000000000",
  connectionId: CONNECTION,
  organizationId: ORG,
  domain: DOMAIN,
};

function audience() {
  return {
    findAdmins: vi.fn<SsoDomainProofAudience["findAdmins"]>(async () => [
      { userId: "user_ana", email: "ana@acme.example" },
      { userId: "user_bo", email: "bo@acme.example" },
    ]),
    getOrganizationName: vi.fn<SsoDomainProofAudience["getOrganizationName"]>(
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
        idempotencyKey: `${NOTICE}:user_ana`,
      });
    });

    /** @scenario "Each domain-proof mail carries a delivery key naming its notice and its administrator" */
    it("gives each administrator's mail the notice's key and their own user id", async () => {
      const sent = mail();
      const service = SsoDomainProofNotificationService.create({
        audience: audience(),
        mail: sent,
      });

      await service.proofWavering(WAVERING);
      await service.proofLapsed({ ...LAPSED, notificationKey: "sso-domain-proof:lapsed:k" });

      expect(sent.sendProofWavering.mock.calls.map(([mailed]) => mailed.idempotencyKey)).toEqual([
        `${NOTICE}:user_ana`,
        `${NOTICE}:user_bo`,
      ]);
      expect(sent.sendProofLapsed.mock.calls.map(([mailed]) => mailed.idempotencyKey)).toEqual([
        "sso-domain-proof:lapsed:k:user_ana",
        "sso-domain-proof:lapsed:k:user_bo",
      ]);
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
        "idempotencyKey",
        "organizationName",
        "record",
      ]);
    });

    /** @scenario "Every administrator who can still sign in is told, and one bad address stops nobody" */
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
      reads.getOrganizationName.mockRejectedValue(new OrganizationNotFoundError("org-1"));
      const service = SsoDomainProofNotificationService.create({ audience: reads, mail: sent });

      await service.proofWavering(WAVERING);

      expect(sent.sendProofWavering).toHaveBeenCalledWith(
        expect.objectContaining({ organizationName: "your organization" }),
      );
    });

    it("sends nothing at all when the organization has no administrator left", async () => {
      const sent = mail();
      const reads = audience();
      reads.findAdmins.mockResolvedValue([]);
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

      await service.proofLapsed(LAPSED);

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
      await expect(unaddressed.proofLapsed(LAPSED)).resolves.toBeUndefined();
    });
  });
});
