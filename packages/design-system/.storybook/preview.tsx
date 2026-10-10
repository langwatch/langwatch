import type { Preview } from "@storybook/react-vite";

import "./fonts.css";
import { Box, Flex } from "../src/primitives.ts";
import { DesignSystemProvider } from "../src/provider/index.tsx";
import { ThemedDocsContainer } from "./docs-container.tsx";
import { DocsPage } from "./docs-page.tsx";

/**
 * Every story mounts the package's own provider, so it shows the tokens an application
 * receives. "System" follows the OS; the others pin a mode. Docs pages follow the same mode
 * (docs-container.tsx), so a story's text always sits on a ground of its own mode.
 */
const preview: Preview = {
  // A component is one docs page in the sidebar, its states on that page, not a folder of
  // stories to open. Cover pages opt back in with `dev`.
  tags: ["autodocs", "!dev"],
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
    // Set by an overview card's preview (`globals=thumb:on`): the story, centred, nothing else.
    thumb: { description: "Overview thumbnail" },
  },
  initialGlobals: {
    colorMode: "system",
    thumb: "off",
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
    docs: { page: DocsPage, container: ThemedDocsContainer },
    options: {
      // The sidebar follows what a developer reaches for, not the folders.
      storySort: {
        method: "alphabetical",
        order: [
          "Start here",
          ["Introduction"],
          "Foundations",
          ["Tokens", "Colour", "Typography", "Gradients and brand surfaces", "Icons", "*"],
          "Primitives",
          ["Overview", "*"],
          "Inputs and forms",
          ["Overview", "*"],
          "Data display",
          ["Overview", "*"],
          "Feedback",
          ["Overview", "*"],
          "Overlays",
          ["Overview", "*"],
          "Navigation and layout",
          ["Overview", "*"],
          "Chrome and app shell",
          ["Overview", "*"],
          "Brand",
          ["Overview", "*"],
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
          {context.globals.thumb === "on" ? (
            <Flex minHeight="100vh" align="center" justify="center" padding={8} color="fg">
              <Story />
            </Flex>
          ) : (
            <Box color="fg">
              <Story />
            </Box>
          )}
        </DesignSystemProvider>
      );
    },
  ],
};

export default preview;
