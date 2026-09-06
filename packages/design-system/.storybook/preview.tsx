import type { Preview } from "@storybook/react-vite";
import "./fonts.css";
import { DesignSystemProvider } from "../src/provider/index.tsx";

/**
 * Every story mounts the package's own provider and system, so a story shows
 * the tokens a consuming application receives rather than Chakra's defaults.
 * "System" follows the viewer's operating system; the other two pin a mode.
 */
const preview: Preview = {
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
