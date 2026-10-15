/**
 * What a browser installs when it installs notification: who has
 * unsubscribed from a project's notifications, and undoing it.
 */

import { defineBrowserModule } from "@langwatch/browser";
import { notificationWebConfigSchema } from "@langwatch/notification-contract";

export const notificationWeb = defineBrowserModule("notification")
  .withConfig({ notification: notificationWebConfigSchema }, ({ notification }) => ({
    hasEmailProvider: notification.email,
  }))
  .withHosts({
    requires: ["NotificationHostApi"],
    mounts: {
      NotificationHostApi: { load: () => import("./behavior/notification-host-mount.tsx") },
    },
  })
  .withScreens({
    // Placed by the application's settings table until a settings anchor
    // accepts declared routes; the loader is this module's either way.
    "pages/settings/email-suppressions": {
      path: "/settings/email-suppressions",
      within: "settings",
      label: "Email Suppressions",
      requires: "triggers:view",
      load: () => import("./ui/sections/email-suppressions-screen.tsx"),
    },
  });
