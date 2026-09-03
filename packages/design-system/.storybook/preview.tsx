import type { Preview } from "@storybook/react-vite";
import { DesignSystemProvider } from "../src/provider";

const preview: Preview = {
  globalTypes: {
    colorMode: {
      description: "Design system color mode",
      toolbar: {
        icon: "mirror",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
      },
    },
  },
  initialGlobals: {
    colorMode: "light",
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
      const colorMode = context.globals.colorMode === "dark" ? "dark" : "light";

      return (
        <DesignSystemProvider forcedTheme={colorMode}>
          <Story />
        </DesignSystemProvider>
      );
    },
  ],
};

export default preview;
