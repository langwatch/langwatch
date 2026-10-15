import { Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { ProductScope } from "./product-scope.tsx";
import { useProductAccent } from "./use-product-accent.ts";

function Reading() {
  const accent = useProductAccent();
  return (
    <Text color={accent.roles.fg}>
      {accent.product ?? "no product"}: {accent.colorPalette}
    </Text>
  );
}

const meta = {
  title: "Navigation and layout/Product scope",
  parameters: {
    usage: {
      use: "Declare which product a standalone entry or story belongs to, so tabs and other accent uses draw its accent. Routed pages get theirs from the application.",
      avoid: "A colour prop on a feature, or a scope around ordinary embedded data cells.",
    },
  },
  component: ProductScope,
  tags: ["autodocs"],
  args: { product: "me", children: <Reading /> },
} satisfies Meta<typeof ProductScope>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Me: Story = {};

export const Unscoped: Story = { args: { product: null } };
