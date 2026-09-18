/**
 * What a browser installs when it installs navigation: the addresses that
 * belong to no one feature - the landing redirect, the 404 every unmatched
 * address falls to, and the `@project` forward the old parallel route minted.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const navigationWeb = defineWebModule("navigation").withScreens({
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
});
