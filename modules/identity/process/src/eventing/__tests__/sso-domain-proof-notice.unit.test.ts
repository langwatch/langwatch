/** @vitest-environment node */

import type { IntentContext, ProcessHandlerContext } from "@langwatch/eventing";
import { intentAccessorOf } from "@langwatch/eventing/testing";
import { describe, expect, it, vi } from "vitest";

import type { SsoDomainProofMail } from "../../channels/sso-domain-proof-mail.channel.ts";
import {
  SsoDomainProofNotificationService,
  type SsoDomainProofAudience,
} from "../../services/sso-domain-proof-notification.service.ts";
import {
  runNotifyProofLapsed,
  runNotifyProofWavering,
} from "../sso-domain-proof-notification.intent.ts";
import {
  onDomainProofLapsed,
  onDomainProofWavered,
  SSO_DOMAIN_PROOF_NOTIFICATION_INITIAL_STATE,
  type SsoDomainProofNotificationIntents,
} from "../sso-domain-proof-notification.process.ts";

const ORG = "org_acme";
const CONNECTION = "ssoc_1";
const DOMAIN = "acme.example";
const T0 = 1_756_000_000_000;
const GRACE_MS = 48 * 60 * 60 * 1000;

function handlerContext(at: number): ProcessHandlerContext<SsoDomainProofNotificationIntents> {
  return {
    at,
    now: at,
    key: CONNECTION,
    projectId: ORG,
    intent: intentAccessorOf({
      notifyWavering: (messageKey, payload) => ({
        messageKey,
        intentType: "notifyWavering",
        payload,
      }),
      notifyLapsed: (messageKey, payload) => ({
        messageKey,
        intentType: "notifyLapsed",
        payload,
      }),
    }),
  };
}

function intentContext(messageKey: string): IntentContext {
  return {
    processName: "ssoDomainProofNotification",
    projectId: ORG,
    processKey: CONNECTION,
    tenantId: ORG,
    messageKey,
    attempt: 1,
  };
}

/** The real service; only the audience and the mail gateway are doubles. */
function composed() {
  const audience: SsoDomainProofAudience = {
    findAdmins: vi.fn(async () => [
      { userId: "user_ana", email: "ana@acme.example" },
      { userId: "user_bo", email: "bo@acme.example" },
    ]),
    getOrganizationName: vi.fn(async () => "Acme Corp"),
  };
  const mail = {
    sendProofWavering: vi.fn<SsoDomainProofMail["sendProofWavering"]>(async () => undefined),
    sendProofLapsed: vi.fn<SsoDomainProofMail["sendProofLapsed"]>(async () => undefined),
  };
  const notifications = SsoDomainProofNotificationService.create({ audience, mail });

  return { mail, notifications };
}

describe("a domain proof that goes missing, from the fact to the mail", () => {
  /** @scenario "The administrators are told when the record goes, and again when it is too late" */
  it("tells each administrator what to publish and by when, then again when the grace ran out", async () => {
    const { mail, notifications } = composed();
    const fact = { connectionId: CONNECTION, domain: DOMAIN, firstAbsentAtMs: T0 };

    const wavering = onDomainProofWavered(
      SSO_DOMAIN_PROOF_NOTIFICATION_INITIAL_STATE,
      { ...fact, graceEndsAtMs: T0 + GRACE_MS },
      handlerContext(T0),
    ).intents?.[0];
    await runNotifyProofWavering({ notifications })(
      wavering?.payload as Parameters<ReturnType<typeof runNotifyProofWavering>>[0],
      intentContext(wavering?.messageKey ?? ""),
    );

    expect(mail.sendProofLapsed).not.toHaveBeenCalled();
    expect(mail.sendProofWavering).toHaveBeenCalledTimes(2);
    expect(mail.sendProofWavering.mock.calls.map(([sent]) => sent.adminEmail)).toEqual([
      "ana@acme.example",
      "bo@acme.example",
    ]);
    for (const [sent] of mail.sendProofWavering.mock.calls) {
      expect(sent).toMatchObject({
        organizationName: "Acme Corp",
        domain: DOMAIN,
        record: { recordType: "TXT", recordName: `_langwatch-verification.${DOMAIN}` },
        graceEndsAtMs: T0 + GRACE_MS,
      });
      expect(Object.keys(sent).toSorted()).toEqual([
        "adminEmail",
        "domain",
        "graceEndsAtMs",
        "idempotencyKey",
        "organizationName",
        "record",
      ]);
    }

    const lapsed = onDomainProofLapsed(
      SSO_DOMAIN_PROOF_NOTIFICATION_INITIAL_STATE,
      fact,
      handlerContext(T0 + GRACE_MS),
    ).intents?.[0];
    await runNotifyProofLapsed({ notifications })(
      lapsed?.payload as Parameters<ReturnType<typeof runNotifyProofLapsed>>[0],
      intentContext(lapsed?.messageKey ?? ""),
    );

    expect(mail.sendProofLapsed).toHaveBeenCalledTimes(2);
    expect(mail.sendProofLapsed.mock.calls.map(([sent]) => sent.adminEmail)).toEqual([
      "ana@acme.example",
      "bo@acme.example",
    ]);
    for (const [sent] of mail.sendProofLapsed.mock.calls) {
      expect(sent).toMatchObject({
        domain: DOMAIN,
        record: { recordName: `_langwatch-verification.${DOMAIN}` },
      });
      expect(Object.keys(sent)).not.toContain("graceEndsAtMs");
    }
    const first = mail.sendProofWavering.mock.calls[0]?.[0].idempotencyKey;
    const second = mail.sendProofLapsed.mock.calls[0]?.[0].idempotencyKey;
    expect(second).not.toBe(first);
  });
});
