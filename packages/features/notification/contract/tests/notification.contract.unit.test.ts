import { describe, expect, it } from "vitest";
import { createNotificationCommandSchema, notificationSchema } from "../src/index";

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
    ).toThrow();
  });
});
