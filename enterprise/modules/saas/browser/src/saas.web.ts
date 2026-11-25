/**
 * What a browser installs when it installs saas: the footer block that
 * identifies the signed-in user to product analytics and loads the hosted
 * scripts. Only a hosted deployment draws it.
 */

import { defineBrowserModule } from "@langwatch/browser";

import { assertCrispChatHidden } from "./behavior/crisp-bubble-policy.ts";

export const saasWeb = defineBrowserModule("saas").withCapabilities({
  // The shell's supportChat port: a screen re-hides the one bubble policy, never its own copy.
  supportChat: { hide: assertCrispChatHidden },
  extraFooterComponents: {
    load: async () => ({
      default: (await import("./extra-footer-components.tsx")).ExtraFooterComponents,
    }),
  },
});
