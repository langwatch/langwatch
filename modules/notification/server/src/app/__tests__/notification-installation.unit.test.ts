import { NotificationApi } from "@langwatch/notification-contract";
import { createApp, withMemoryRepositories } from "@langwatch/runtime-composition";
import { describe, expect, it } from "vitest";
import { notificationServer } from "../../notification.server.ts";
import { createNotificationTestApp } from "./notification.fixture.ts";

function process(role: "api" | "worker") {
  return createApp({ role, config: {} })
    .withModules([withMemoryRepositories(notificationServer)]);
}

const record = {
  organizationId: "organization-1",
  metadata: { kind: "usage-limit" },
  sentAt: new Date("2026-08-25T00:00:00.000Z"),
};

const since = new Date("2026-08-24T00:00:00.000Z");

describe("notification app installation", () => {
  it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
    const runtime = await process(role).boot();

    try {
      const app = runtime.service(NotificationApi);
      const created = await app.create(record);

      expect(runtime.module(notificationServer).provided).toBe(app);

      await expect(
        app.listRecentByOrganization({ organizationId: "organization-1", since }),
      ).resolves.toEqual([created]);
    } finally {
      await runtime.stop();
    }
  });

  it("allocates independent memory repositories for each installation", async () => {
    const first = await process("api").boot();
    const second = await process("api").boot();

    try {
      await first.service(NotificationApi).create(record);

      await expect(
        second
          .service(NotificationApi)
          .listRecentByOrganization({ organizationId: "organization-1", since }),
      ).resolves.toEqual([]);
    } finally {
      await Promise.all([first.stop(), second.stop()]);
    }
  });

  describe("when the app is built directly over memory repositories", () => {
    it("answers nothing for an organization that was never written to", async () => {
      const app = createNotificationTestApp();

      await expect(
        app.listRecentByOrganization({ organizationId: "organization-2", since }),
      ).resolves.toEqual([]);
    });
  });
});
