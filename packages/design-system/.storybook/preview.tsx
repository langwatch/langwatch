import type { Preview } from "@storybook/react-vite";

import "./fonts.css";
import { DesignSystemProvider } from "../src/provider/index.tsx";
import { DocsPage } from "./docs-page.tsx";

/**
 * Every story mounts the package's own provider and system, so a story shows
 * the tokens a consuming application receives rather than Chakra's defaults.
 * "System" follows the viewer's operating system; the other two pin a mode.
 */
const preview: Preview = {
  tags: ["autodocs"],
  globalTypes: {
    colorMode: {
      description: "Design system color mode",
      toolbar: {
        icon: "mirror",
        items: [
          { value: "system", title: "System" },
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    colorMode: "system",
  },
  parameters: {
    a11y: {
      element: "#storybook-root",
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /date$/i,
      },
    },
    layout: "padded",
    docs: { page: DocsPage },
    options: {
      // The sidebar follows what a developer reaches for, not the folders.
      storySort: {
        method: "alphabetical",
        order: [
          "Start here",
          ["Introduction", "Component gallery"],
          "Foundations",
          ["Tokens", "Colour", "Typography", "Gradients and brand surfaces", "Icons", "*"],
          "Primitives",
          "Inputs and forms",
          "Data display",
          "Feedback",
          "Overlays",
          "Navigation and layout",
          "Chrome and app shell",
          "Brand",
          "Patterns",
          ["Using them together", "*"],
          "Consistency",
          ["Scoreboard", "*"],
        ],
      },
    },
  },
  decorators: [
    (Story, context) => {
      const chosen = context.globals.colorMode;
      const forcedTheme = chosen === "light" || chosen === "dark" ? chosen : undefined;

      return (
        <DesignSystemProvider forcedTheme={forcedTheme} enableSystem defaultTheme="system">
          <Story />
        </DesignSystemProvider>
      );
    },
  ],
};

export default preview;
