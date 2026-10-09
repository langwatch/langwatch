/**
 * Licensing records its Connect facts on its own pipeline instead of writing organization's row.
 * @see enterprise/modules/licensing/specs/licensing.feature
 */
import { createHash } from "node:crypto";

import type { EventingCommands } from "@langwatch/eventing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { LicensingCustomerPipeline } from "../../eventing/licensing-customer.pipeline.ts";
import { LicensingCustomerFactsService } from "../licensing-customer-facts.service.ts";

type Senders = EventingCommands<LicensingCustomerPipeline>;

const ORGANIZATION = "organization_2abcConnectFacts";
const SYNCED_AT = Date.UTC(2026, 9, 9, 12);

function connectedFacts() {
  const sent: Record<string, unknown>[] = [];
  const facts = LicensingCustomerFactsService.create();
  facts.connect(
    createApiFixture<Senders>({
      recordConnectServiceSwitched: createApiFixture<Senders["recordConnectServiceSwitched"]>({
        send: async (payload) => void sent.push(payload),
      }),
      recordLicenseSyncFinished: createApiFixture<Senders["recordLicenseSyncFinished"]>({
        send: async (payload) => void sent.push(payload),
      }),
      recordLicenseStored: createApiFixture<Senders["recordLicenseStored"]>({
        send: async (payload) => void sent.push(payload),
      }),
      recordLicenseCleared: createApiFixture<Senders["recordLicenseCleared"]>({
        send: async (payload) => void sent.push(payload),
      }),
      recordManagedKeyRetired: createApiFixture<Senders["recordManagedKeyRetired"]>({
        send: async (payload) => void sent.push(payload),
      }),
      recordManagedKeyInvalidated: createApiFixture<Senders["recordManagedKeyInvalidated"]>({
        send: async (payload) => void sent.push(payload),
      }),
      recordContractTermsChanged: createApiFixture<Senders["recordContractTermsChanged"]>({
        send: async (payload) => void sent.push(payload),
      }),
    }),
  );
  return { facts, sent };
}

describe("licensing's Connect facts", () => {
  describe("when an administrator switches a hosted service off", () => {
    /** @scenario "Licensing records a hosted-service switch as a fact for organization to apply" */
    it("records the switch for that organization", async () => {
      const { facts, sent } = connectedFacts();

      await facts.connectServiceSwitched({
        organizationId: ORGANIZATION,
        service: "instant_evals",
        enabled: false,
      });

      expect(sent).toEqual([
        {
          tenantId: ORGANIZATION,
          occurredAt: expect.any(Number),
          organizationId: ORGANIZATION,
          service: "instant_evals",
          enabled: false,
        },
      ]);
    });
  });

  describe("when a license sync ends", () => {
    it("records the moment it ended and the code it failed on", async () => {
      const { facts, sent } = connectedFacts();

      await facts.licenseSyncFinished({
        organizationId: ORGANIZATION,
        at: Temporal.Instant.fromEpochMilliseconds(SYNCED_AT),
        error: "license_sync_failed",
      });

      expect(sent).toEqual([
        {
          tenantId: ORGANIZATION,
          occurredAt: SYNCED_AT,
          organizationId: ORGANIZATION,
          error: "license_sync_failed",
        },
      ]);
    });
  });

  describe("when a licence is stored and then cleared", () => {
    /** @scenario "Licensing records a stored or cleared licence as a fact for organization to apply" */
    it("records the key and its dates, then the clearing", async () => {
      const { facts, sent } = connectedFacts();
      const expiresAt = Temporal.Instant.from("2027-01-01T00:00:00Z");

      await facts.licenseStored({
        organizationId: ORGANIZATION,
        license: { licenseKey: "key", expiresAt, validatedAt: null },
      });
      await facts.licenseCleared({ organizationId: ORGANIZATION });

      expect(sent).toEqual([
        {
          tenantId: ORGANIZATION,
          occurredAt: expect.any(Number),
          organizationId: ORGANIZATION,
          licenseKeyFingerprint: createHash("sha256").update("key").digest("hex"),
          expiresAt: expiresAt.epochMilliseconds,
          validatedAt: null,
        },
        { tenantId: ORGANIZATION, occurredAt: expect.any(Number), organizationId: ORGANIZATION },
      ]);
    });
  });

  describe("when licensing ends a licence's managed key and then re-resolves another", () => {
    /** @scenario "Licensing records ending or re-resolving a licence's managed key as a fact for gateway to apply" */
    it("records the key, its organisation and the actor, then the key to resolve again", async () => {
      const { facts, sent } = connectedFacts();

      await facts.managedKeyRetired({
        virtualKeyId: "vk-old",
        organizationId: ORGANIZATION,
        actorId: "operator-1",
      });
      await facts.managedKeyInvalidated({ virtualKeyId: "vk-new", organizationId: ORGANIZATION });

      expect(sent).toEqual([
        {
          tenantId: ORGANIZATION,
          occurredAt: expect.any(Number),
          organizationId: ORGANIZATION,
          virtualKeyId: "vk-old",
          actorId: "operator-1",
        },
        {
          tenantId: ORGANIZATION,
          occurredAt: expect.any(Number),
          organizationId: ORGANIZATION,
          virtualKeyId: "vk-new",
        },
      ]);
    });
  });

  describe("when a licence change may have moved a customer's contract terms", () => {
    /** @scenario "Issuing, revoking, changing terms or linking a licence records contract_terms_changed" */
    it("records the organization and the operator for connect to sync from", async () => {
      const { facts, sent } = connectedFacts();

      await facts.contractTermsChanged({ organizationId: ORGANIZATION, operatorId: "operator-1" });

      expect(sent).toEqual([
        {
          tenantId: ORGANIZATION,
          occurredAt: expect.any(Number),
          organizationId: ORGANIZATION,
          operatorId: "operator-1",
        },
      ]);
    });
  });

  describe("when the pipeline senders are not connected", () => {
    it("refuses rather than dropping the fact", async () => {
      await expect(
        LicensingCustomerFactsService.create().connectServiceSwitched({
          organizationId: ORGANIZATION,
          service: "instant_evals",
          enabled: true,
        }),
      ).rejects.toThrow("not connected");
    });
  });
});
