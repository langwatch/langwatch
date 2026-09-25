import { createApp, withMemoryRepositories } from "@langwatch/kernel";
import { NotificationService as NotificationApi } from "@langwatch/notification-contract";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { describe, expect, it } from "vitest";

import { notificationServer } from "../../notification.server.ts";
import { NotificationApp } from "../notification.app.ts";
import { createNotificationTestApp } from "./notification.fixture.ts";

/** Secrets come from an empty environment, as data-privacy's installation fixture does. */
function installableNotification(resolver: SecretsResolver) {
  const server = withMemoryRepositories(notificationServer);
  const secrets = resolver.scopeTo("notification", Object.values(NotificationApp.secrets));
  const installable: typeof server = {
    ...server,
    install: (args) => server.install({ ...args, secrets }),
  };
  return installable;
}

function process(
  role: "api" | "worker",
  resolver = SecretsResolver.over(SecretsChain.start({ environment: {} })),
) {
  return createApp({ role })
    .withModules([installableNotification(resolver)])
    .withConfig({
      notification: {
        defaultFrom: undefined,
        provider: undefined,
        ses: { enabled: undefined, region: undefined, endpoint: undefined },
        smtp: { host: undefined, port: undefined, user: undefined, secure: undefined },
      },
    });
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

  it("reports how mail leaves the install after boot has sealed the secrets", async () => {
    const resolver = SecretsResolver.over(SecretsChain.start({ environment: {} }));
    const runtime = await process("api", resolver).boot();
    resolver.seal();

    try {
      await expect(runtime.service(NotificationApi).getMailDelivery()).resolves.toMatchObject({
        smtpConfigured: false,
      });
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
      const app = await createNotificationTestApp();

      await expect(
        app.listRecentByOrganization({ organizationId: "organization-2", since }),
      ).resolves.toEqual([]);
    });
  });
});
