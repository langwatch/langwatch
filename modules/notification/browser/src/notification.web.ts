/**
 * What a browser installs when it installs notification: who has
 * unsubscribed from a project's notifications, and undoing it.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const notificationWeb = defineWebModule("notification")
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
      load: () => import("./ui/sections/email-suppressions-screen.tsx"),
    },
  });
