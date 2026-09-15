import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  // Stories live next to the component they document. `stories/` keeps the
  // foundations, which document tokens rather than a component.
  stories: ["../src/**/*.stories.@(ts|tsx)", "../stories/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-a11y", "@storybook/addon-docs"],
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
