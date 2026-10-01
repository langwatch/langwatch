/**
 * What a browser installs when it installs navigation: the addresses that
 * belong to no one feature - the landing redirect, the 404 every unmatched
 * address falls to, and the `@project` forward the old parallel route minted.
 */

import { featureFlagTrpc } from "@langwatch/feature-flag-contract";
import { defineWebModule } from "@langwatch/browser";

import { navigationApi } from "./behavior/navigation-api.ts";

export const navigationWeb = defineWebModule("navigation")
  // navigationApi reads featureFlag.*, so the flags' session tier travels with it.
  .withApi(navigationApi, { contracts: [featureFlagTrpc] })
  .withScreens({
    "pages/index": {
      load: () => import("./ui/sections/navigation/landing.screen.tsx"),
    },
    "pages/not-found": {
      load: () => import("./ui/sections/navigation/not-found.screen.tsx"),
    },
    "pages/settings/not-found": {
      load: () => import("./ui/sections/navigation/not-found.screen.tsx"),
    },
    "pages/@project/[...path]/index": {
      load: () => import("./ui/sections/navigation/project-redirect.screen.tsx"),
    },
  })
  .withCapabilities({
    /** The host port the shell answers, and its provider; loaded before the shell renders. */
    host: { load: () => import("./navigation.ts") },
    /** The frame drawn around every address behind a session. */
    chrome: { load: () => import("./ui/index.ts") },
    /** The search palette the chrome layout mounts once. */
    commandBar: { load: () => import("./command-bar.ts") },
    /** The palette drawn inline in a landing hero, lent to project (§3.4 rule 7). */
    inlineCommandPalette: {
      load: async () => ({
        default: (await import("./ui/sections/inline-command-palette.tsx")).InlineCommandPalette,
      }),
    },
  });
