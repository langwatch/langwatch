import type { StorybookConfig } from "@storybook/react-vite";

import { collectAdoption } from "./adoption.ts";

/** The import counts every docs page shows; a build without git shows none rather than failing. */
function adoptionJson(): string {
  try {
    return JSON.stringify(collectAdoption());
  } catch {
    return "";
  }
}

const config: StorybookConfig = {
  // Stories live next to what they document: a component, the tokens in
  // `src/system`, or the workshop's own pages in `src/workshop`.
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-a11y", "@storybook/addon-docs"],
  // Chakra's own Storybook, composed in because its package names it; folded until wanted.
  refs: {
    "@chakra-ui/react": {
      title: "Chakra UI",
      url: "https://storybook.chakra-ui.com",
      expanded: false,
    },
  },
  env: (existing) => ({ ...existing, STORYBOOK_DESIGN_SYSTEM_ADOPTION: adoptionJson() }),
  // The self-hosted display face. One copy of the woff2 files exists, in the
  // browser application's public directory, because that is the only place a
  // deployed browser fetches them from; Storybook serves the same directory
  // rather than keeping a second copy that could drift.
  staticDirs: ["../../../apps/ui/public"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
};

export default config;
