/**
 * What a browser installs when it installs api-key: the API Keys settings
 * screen, the CLI device-flow authorize screen and the two handoff consent
 * screens (project authorize, MCP authorize); it lends the Braids page its signing keys panel.
 */

import { SigningKeysPanelToken } from "@langwatch/api-key-client";
import { defineBrowserModule } from "@langwatch/browser";

export const apiKeyWeb = defineBrowserModule("api-key")
  .withHosts({
    requires: ["ApiKeyHostApi", "AuthorizeHostApi"],
    mounts: {
      ApiKeyHostApi: { load: () => import("./behavior/api-key-host-mount.tsx") },
      AuthorizeHostApi: { load: () => import("./behavior/authorize-host-mount.tsx") },
    },
  })
  .withScreens({
    "pages/authorize": {
      path: "/authorize",
      load: () => import("./ui/sections/authorize-screen.tsx"),
    },
    "pages/mcp/authorize": {
      path: "/mcp/authorize",
      load: () => import("./ui/sections/mcp-authorize-screen.tsx"),
    },
    "pages/cli/auth": {
      path: "/cli/auth",
      load: () => import("./ui/sections/cli-auth-screen.tsx"),
    },
    // Placed by the application's settings table until a settings anchor
    // accepts declared routes; the loader is this module's either way.
    "pages/settings/api-keys": {
      path: "/settings/api-keys",
      within: "settings",
      label: "API keys",
      load: () => import("./ui/sections/api-keys-screen.tsx"),
    },
  })
  /** A project's braid signing keys, mounted by the Braids page (ADR-183 §4). */
  .lends(SigningKeysPanelToken, {
    load: async () => ({
      default: (await import("./ui/sections/signing-keys-panel.tsx")).SigningKeysPanel,
    }),
  });
