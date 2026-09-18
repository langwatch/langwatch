/**
 * What a browser installs when it installs api-key: the API Keys settings
 * screen, the CLI device-flow authorize screen and the two handoff consent
 * screens (project authorize, MCP authorize).
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const apiKeyWeb = defineWebModule("api-key").withScreens({
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
    label: "API Keys",
    load: () => import("./ui/sections/api-keys-screen.tsx"),
  },
});
