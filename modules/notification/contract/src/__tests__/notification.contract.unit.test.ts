import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import {
  createNotificationCommandSchema,
  notificationSchema,
  sendEmailCommandSchema,
} from "../index.ts";

describe("Notification contract", () => {
  it("accepts the persisted notification shape", () => {
    const timestamp = new Date("2026-08-25T00:00:00.000Z");

    expect(
      notificationSchema.parse({
        id: "notification-1",
        organizationId: "organization-1",
        projectId: null,
        metadata: { kind: "usage-limit", threshold: 90 },
        createdAt: timestamp,
        updatedAt: timestamp,
        sentAt: timestamp,
      }),
    ).toMatchObject({ id: "notification-1" });
  });

  it("rejects unknown command fields", () => {
    expect(() =>
      createNotificationCommandSchema.parse({
        organizationId: "organization-1",
        metadata: {},
        sentAt: new Date(),
        unexpected: true,
      }),
    ).toThrow(ZodError);
  });

  it("refuses raw headers on a send: the envelope is notification's to write", () => {
    expect(() =>
      sendEmailCommandSchema.parse({
        to: "ada@example.com",
        subject: "hi",
        html: "<p>hi</p>",
        headers: { "List-Unsubscribe": "<https://evil.test>" },
      }),
    ).toThrow(ZodError);
  });

  it("refuses a replyless tag that could break out of the no-reply address", () => {
    expect(() =>
      sendEmailCommandSchema.parse({
        to: "ada@example.com",
        subject: "hi",
        html: "<p>hi</p>",
        replyless: { tag: "x@evil.test>\r\nBcc: all@acme.test" },
      }),
    ).toThrow(ZodError);
  });
});
