// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import type {
  IntentContext,
  ProcessHandlerContext,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";
import {
  onDomainProofLapsed,
  onDomainProofWavered,
  type PrepareSsoDomainProofNotification,
  runFanoutSsoDomainProofNotification,
  runPrepareSsoDomainProofNotification,
  runSendSsoDomainProofNotification,
  type SendSsoDomainProofNotification,
  type SsoDomainProofNotificationIntents,
  type SsoDomainProofNotificationPort,
} from "../sso-domain-proof-notification.process";

const ORGANIZATION_ID = "org_acme";
const CONNECTION_ID = "connection_acme";
const DOMAIN = "acme.test";
const FIRST_ABSENT_AT = 1_756_000_000_000;
const GRACE_ENDS_AT = FIRST_ABSENT_AT + 48 * 60 * 60 * 1000;

function context(): ProcessHandlerContext<SsoDomainProofNotificationIntents> {
  return {
    at: FIRST_ABSENT_AT,
    now: FIRST_ABSENT_AT + 100,
    key: CONNECTION_ID,
    projectId: ORGANIZATION_ID,
    intents: {
      prepare: (key, payload) => ({
        messageKey: key,
        intentType: "prepare",
        payload,
      }),
      fanout: (key, payload) => ({
        messageKey: key,
        intentType: "fanout",
        payload,
      }),
      send: (key, payload) => ({
        messageKey: key,
        intentType: "send",
        payload,
      }),
    },
  };
}

describe("SSO domain proof notification process", () => {
  /** @scenario "The administrators are told when the record goes, and again when it is too late" */
  it("creates one stable preparation intent for a wavered fact", () => {
    const data = {
      connectionId: CONNECTION_ID,
      domain: DOMAIN,
      firstAbsentAtMs: FIRST_ABSENT_AT,
      graceEndsAtMs: GRACE_ENDS_AT,
      actor: { type: "system" as const, id: null },
      source: "self-serve" as const,
    };

    const first = onDomainProofWavered({}, data, context());
    const retry = onDomainProofWavered({}, data, context());

    expect(first).toEqual(retry);
    expect(first.intents).toEqual([
      {
        messageKey: `prepare:sso-domain-proof:wavering:${CONNECTION_ID}:${DOMAIN}:${FIRST_ABSENT_AT}`,
        intentType: "prepare",
        payload: {
          kind: "wavering",
          notificationId: `sso-domain-proof:wavering:${CONNECTION_ID}:${DOMAIN}:${FIRST_ABSENT_AT}`,
          connectionId: CONNECTION_ID,
          organizationId: ORGANIZATION_ID,
          domain: DOMAIN,
          graceEndsAtMs: GRACE_ENDS_AT,
        },
      },
    ]);
  });

  it("uses a separate stable identity for the lapsed fact", () => {
    const evolution = onDomainProofLapsed(
      {},
      {
        connectionId: CONNECTION_ID,
        domain: DOMAIN,
        firstAbsentAtMs: FIRST_ABSENT_AT,
        actor: { type: "system", id: null },
        source: "self-serve",
      },
      context(),
    );

    expect(evolution.intents?.[0]).toMatchObject({
      messageKey: `prepare:sso-domain-proof:lapsed:${CONNECTION_ID}:${DOMAIN}:${FIRST_ABSENT_AT}`,
      payload: {
        kind: "lapsed",
        notificationId: `sso-domain-proof:lapsed:${CONNECTION_ID}:${DOMAIN}:${FIRST_ABSENT_AT}`,
        organizationId: ORGANIZATION_ID,
      },
    });
  });

  it("keeps the rendered delivery snapshot across prepare and delivery retries", async () => {
    const port = {
      prepare:
        vi.fn<(payload: PrepareSsoDomainProofNotification) => Promise<void>>(),
      fanout: vi.fn(),
      send: vi.fn(),
    };
    const prepare = runPrepareSsoDomainProofNotification(port);
    const payload: PrepareSsoDomainProofNotification = {
      kind: "wavering",
      notificationId: "notice-1",
      connectionId: CONNECTION_ID,
      organizationId: ORGANIZATION_ID,
      domain: DOMAIN,
      graceEndsAtMs: GRACE_ENDS_AT,
    };

    await prepare(payload);
    await prepare(payload);
    expect(port.prepare).toHaveBeenCalledTimes(2);
    expect(port.prepare).toHaveBeenNthCalledWith(1, payload);
    expect(port.prepare).toHaveBeenNthCalledWith(2, payload);

    const fanout = runFanoutSsoDomainProofNotification(port);
    const send = runSendSsoDomainProofNotification(port);
    const delivery = {
      notificationId: "notice-1",
      organizationId: ORGANIZATION_ID,
      recipientUserId: "user_admin",
      content: {
        idempotencyKey: "notice-1:user_admin",
        to: "admin@acme.test",
        subject: "Domain proof",
        html: "<p>snapshot</p>",
        from: "LangWatch <noreply@langwatch.ai>",
      },
    };
    const fanoutPayload = {
      ...payload,
      deliveries: [
        {
          recipientUserId: delivery.recipientUserId,
          content: delivery.content,
        },
      ],
    };
    const intentContext: IntentContext = {
      processName: "ssoDomainProofNotification",
      projectId: ORGANIZATION_ID,
      processKey: "notification:notice-1",
      tenantId: ORGANIZATION_ID,
      messageKey: "send:notice-1:user_admin",
      attempt: 1,
    };
    await fanout(fanoutPayload);
    await fanout(fanoutPayload);
    await send(delivery, intentContext);
    await send(delivery, intentContext);

    expect(port.fanout).toHaveBeenCalledTimes(2);
    expect(port.fanout).toHaveBeenLastCalledWith(
      expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        deliveries: [
          expect.objectContaining({
            recipientUserId: delivery.recipientUserId,
            content: delivery.content,
          }),
        ],
      }),
    );
    expect(port.send).toHaveBeenCalledTimes(2);
    expect(port.send).toHaveBeenLastCalledWith(delivery);
  });

  it("retries recipients independently after a transient delivery failure", async () => {
    let shouldFail = true;
    const send = vi.fn(async (payload: SendSsoDomainProofNotification) => {
      if (payload.recipientUserId === "user_a" && shouldFail) {
        shouldFail = false;
        throw new Error("temporary SMTP failure");
      }
    });
    const port: SsoDomainProofNotificationPort = {
      prepare: vi.fn(async () => undefined),
      fanout: vi.fn(async () => undefined),
      send,
    };
    const runSend = runSendSsoDomainProofNotification(port);
    const firstDelivery: SendSsoDomainProofNotification = {
      notificationId: "notice-2",
      organizationId: ORGANIZATION_ID,
      recipientUserId: "user_a",
      content: {
        idempotencyKey: "notice-2:user_a",
        to: "a@acme.test",
        subject: "Domain proof",
        html: "<p>snapshot-a</p>",
        from: "LangWatch <noreply@langwatch.ai>",
      },
    };
    const secondDelivery: SendSsoDomainProofNotification = {
      ...firstDelivery,
      recipientUserId: "user_b",
      content: {
        ...firstDelivery.content,
        idempotencyKey: "notice-2:user_b",
        to: "b@acme.test",
        html: "<p>snapshot-b</p>",
      },
    };
    const intentContext: IntentContext = {
      processName: "ssoDomainProofNotification",
      projectId: ORGANIZATION_ID,
      processKey: "notification:notice-2",
      tenantId: ORGANIZATION_ID,
      messageKey: "send:notice-2:user_a",
      attempt: 1,
    };

    await expect(runSend(firstDelivery, intentContext)).rejects.toThrow(
      "temporary SMTP failure",
    );
    await runSend(secondDelivery, {
      ...intentContext,
      messageKey: "send:notice-2:user_b",
    });
    await runSend(firstDelivery, intentContext);

    expect(send).toHaveBeenNthCalledWith(1, firstDelivery);
    expect(send).toHaveBeenNthCalledWith(2, secondDelivery);
    expect(send).toHaveBeenNthCalledWith(3, firstDelivery);
  });
});
