/**
 * The live trigger repository seals and opens `actionParams` secrets with the
 * deployment's cipher, byte-compatible with what an earlier release stored.
 * @see modules/automation/specs/graph-alert-worker-composition.feature
 */
import { aesEncryption } from "@langwatch/process-stores";
import { frozenAt } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import {
  createGraphActivityPrismaDouble,
  FROZEN_NOW,
  graphTriggerRow,
} from "../../../__tests__/fixtures/graph-activity.fixture.ts";
import { AutomationWebhookSecretsService } from "../../../services/automation-webhook-secrets.service.ts";
import { PrismaTriggerRepository } from "../prisma.trigger.repository.ts";

/** A test key, never a deployment's: 32 bytes of 0x0f. */
const KEY = Buffer.from("0f".repeat(32), "hex");

/** Sealed under KEY by `aesEncryption` before the repository held the cipher. */
const STORED_HEADERS =
  "edeb59e3000ae0fcda3835ad:fa1a0f894f2aec362853e2a962c04cbf99d725d00fb16f023cd56b33a9a3b11f9286a0072542bb50:23e2e86e0ab4357dd60a2cdb87449c4c";
const STORED_SIGNING_SECRET =
  "5c38a86acd0ce41c368e0b8c:feadbe023d7c9138b1130be6f87b57c42cd59f:43117a0d59f0805969b4ab3a2faf0bbb";

function liveRepository() {
  const database = createGraphActivityPrismaDouble({
    triggers: [
      graphTriggerRow({
        action: "SEND_WEBHOOK",
        actionParams: {
          url: "https://hooks.example.com/alerts",
          method: "POST",
          bodyTemplate: null,
          headersEncrypted: STORED_HEADERS,
          signingSecretEncrypted: STORED_SIGNING_SECRET,
        },
      }),
    ],
  });
  return PrismaTriggerRepository.create(database.prisma, frozenAt(FROZEN_NOW), aesEncryption(KEY));
}

describe("PrismaTriggerRepository", () => {
  describe("given a webhook row an earlier release sealed with this deployment's key", () => {
    /** @scenario "A webhook secret sealed by an earlier release opens through the live trigger repository" */
    it("opens its headers and signing secret in plaintext for the delivery", async () => {
      const triggers = liveRepository();
      const webhooks = AutomationWebhookSecretsService.create(triggers);

      const row = await triggers.findById({ triggerId: "trigger-1", projectId: "project-1" });
      const stored = webhooks.parseStored(row?.actionParams);

      expect(webhooks.decryptHeaders(stored)).toEqual({ Authorization: "Bearer stored-before" });
      expect(webhooks.decryptSigningSecrets(stored)).toEqual(["whsec_stored_before"]);
    });
  });

  describe("given a secret the live repository sealed", () => {
    /** @scenario "What the live trigger repository seals, an earlier release opens" */
    it("is opened unchanged by the deployment's cipher as an earlier release read it", () => {
      const sealed = liveRepository().sealSecret({ plain: "whsec_written_now" });

      expect(aesEncryption(KEY).decrypt(sealed)).toBe("whsec_written_now");
      expect(sealed).not.toContain("whsec_written_now");
    });
  });
});
