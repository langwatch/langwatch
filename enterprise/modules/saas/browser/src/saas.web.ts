/**
 * What a browser installs when it installs saas: the footer block that
 * identifies the signed-in user to product analytics and loads the hosted
 * scripts. Only a hosted deployment draws it.
 */

import { defineBrowserModule } from "@langwatch/browser";

export const saasWeb = defineBrowserModule("saas").withCapabilities({
  extraFooterComponents: {
    load: async () => ({
      default: (await import("./extra-footer-components.tsx")).ExtraFooterComponents,
    }),
  },
});
