/** @vitest-environment node */

import type { ProcessHandlerContext } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";

import {
  runNotifyProofLapsed,
  runNotifyProofWavering,
} from "../sso-domain-proof-notification.intent.ts";
import {
  onDomainProofLapsed,
  onDomainProofWavered,
  SSO_DOMAIN_PROOF_NOTIFICATION_INITIAL_STATE,
  type SsoDomainProofNotificationIntents,
  type SsoDomainProofNotifications,
} from "../sso-domain-proof-notification.process.ts";

const ORG = "org_acme";
const CONNECTION = "ssoc_1";
const DOMAIN = "acme.example";
const T0 = 1_756_000_000_000;
const GRACE_MS = 48 * 60 * 60 * 1000;

function context(at: number): ProcessHandlerContext<SsoDomainProofNotificationIntents> {
  return {
    at,
    now: at,
    key: CONNECTION,
    projectId: ORG,
    intents: {
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
    },
  };
}

const wavered = {
  connectionId: CONNECTION,
  domain: DOMAIN,
  firstAbsentAtMs: T0,
  graceEndsAtMs: T0 + GRACE_MS,
};

describe("the domain-proof notification process", () => {
  describe("given a record that has just gone missing", () => {
    it("asks for one mail carrying the deadline, addressed to the tenant organization", () => {
      const evolution = onDomainProofWavered(
        SSO_DOMAIN_PROOF_NOTIFICATION_INITIAL_STATE,
        wavered,
        context(T0),
      );

      expect(evolution.intents).toHaveLength(1);
      expect(evolution.intents?.[0]).toMatchObject({
        intentType: "notifyWavering",
        payload: {
          connectionId: CONNECTION,
          organizationId: ORG,
          domain: DOMAIN,
          graceEndsAtMs: T0 + GRACE_MS,
        },
      });
    });

    it("remembers nothing and arms no wake: the fact says everything its mail needs", () => {
      const evolution = onDomainProofWavered(
        SSO_DOMAIN_PROOF_NOTIFICATION_INITIAL_STATE,
        wavered,
        context(T0),
      );

      expect(evolution.state).toEqual(SSO_DOMAIN_PROOF_NOTIFICATION_INITIAL_STATE);
      expect(evolution.nextWakeAt).toBeUndefined();
    });

    /** @scenario "The same absence is one notice however many times it arrives" */
    it("keys the same absence the same way, so a redelivery is one mail and not two", () => {
      const first = onDomainProofWavered(
        SSO_DOMAIN_PROOF_NOTIFICATION_INITIAL_STATE,
        wavered,
        context(T0),
      );
      const redelivered = onDomainProofWavered(
        SSO_DOMAIN_PROOF_NOTIFICATION_INITIAL_STATE,
        wavered,
        context(T0 + 90_000),
      );

      expect(redelivered.intents?.[0]?.messageKey).toBe(first.intents?.[0]?.messageKey);
    });

    it("keys a later absence differently, so a domain that goes again is told again", () => {
      const first = onDomainProofWavered(
        SSO_DOMAIN_PROOF_NOTIFICATION_INITIAL_STATE,
        wavered,
        context(T0),
      );
      const again = onDomainProofWavered(
        SSO_DOMAIN_PROOF_NOTIFICATION_INITIAL_STATE,
        { ...wavered, firstAbsentAtMs: T0 + GRACE_MS, graceEndsAtMs: T0 + 2 * GRACE_MS },
        context(T0 + GRACE_MS),
      );

      expect(again.intents?.[0]?.messageKey).not.toBe(first.intents?.[0]?.messageKey);
    });
  });

  describe("given the grace ran out", () => {
    it("asks for the second mail, under a key the first one cannot collapse into", () => {
      const first = onDomainProofWavered(
        SSO_DOMAIN_PROOF_NOTIFICATION_INITIAL_STATE,
        wavered,
        context(T0),
      );
      const evolution = onDomainProofLapsed(
        SSO_DOMAIN_PROOF_NOTIFICATION_INITIAL_STATE,
        { connectionId: CONNECTION, domain: DOMAIN, firstAbsentAtMs: T0 },
        context(T0 + GRACE_MS),
      );

      expect(evolution.intents?.[0]).toMatchObject({
        intentType: "notifyLapsed",
        payload: { connectionId: CONNECTION, organizationId: ORG, domain: DOMAIN },
      });
      expect(evolution.intents?.[0]?.messageKey).not.toBe(first.intents?.[0]?.messageKey);
    });
  });

  describe("given the intents run", () => {
    it("hands each notice to the service, with the deadline only where there is one", async () => {
      const notifications = {
        proofWavering: vi.fn<SsoDomainProofNotifications["proofWavering"]>(async () => {}),
        proofLapsed: vi.fn<SsoDomainProofNotifications["proofLapsed"]>(async () => {}),
      };

      await runNotifyProofWavering({ notifications })({
        connectionId: CONNECTION,
        organizationId: ORG,
        domain: DOMAIN,
        firstAbsentAtMs: T0,
        graceEndsAtMs: T0 + GRACE_MS,
      });
      await runNotifyProofLapsed({ notifications })({
        connectionId: CONNECTION,
        organizationId: ORG,
        domain: DOMAIN,
        firstAbsentAtMs: T0,
      });

      expect(notifications.proofWavering).toHaveBeenCalledWith({
        connectionId: CONNECTION,
        organizationId: ORG,
        domain: DOMAIN,
        graceEndsAtMs: T0 + GRACE_MS,
      });
      expect(notifications.proofLapsed).toHaveBeenCalledWith({
        connectionId: CONNECTION,
        organizationId: ORG,
        domain: DOMAIN,
      });
    });
  });
});
