import { Box, Grid, Stack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { ContentTabs } from "../components/layout/content-tabs.tsx";
import { ProductScope } from "../components/scope/product-scope.tsx";
import { type ProductAccent, useProductAccent } from "../components/scope/use-product-accent.ts";
import {
  PRODUCT_COLOURS,
  PRODUCT_NAMES,
  PRODUCT_ROLES,
  resolveProductPalette,
} from "./product-colours.ts";

const meta = {
  title: "Foundations/Product colours",
  parameters: {
    usage: {
      use: "Which accent each product draws. One file, product-colours.ts, assigns it: Me is blue, LLM Ops, Gateway and Governance keep the existing accent. Tabs and other accent uses read it through useProductAccent.",
      avoid:
        "Choosing blue or orange by module. Status, chart, vendor and brand colours do not read this map.",
    },
  },
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function Swatches({ accent }: { accent: ProductAccent }) {
  return (
    <Stack direction="row" gap={1} flexWrap="wrap">
      {PRODUCT_ROLES.map((role) => (
        <Box
          key={role}
          title={accent.roles[role]}
          boxSize="6"
          borderRadius="sm"
          borderWidth="1px"
          borderColor="border"
          bg={accent.roles[role]}
        />
      ))}
    </Stack>
  );
}

function Surface({ label }: { label: string }) {
  const accent = useProductAccent();
  const [value, setValue] = useState("overview");
  return (
    <Stack gap={2} padding={3} borderWidth="1px" borderColor="border" borderRadius="md">
      <Text textStyle="xs" color="fg.muted">
        {label}
        {accent.product === null
          ? ", unscoped"
          : ` -> ${resolveProductPalette({ colour: PRODUCT_COLOURS[accent.product] })}`}
      </Text>
      <ContentTabs
        label={`${label} sections`}
        value={value}
        onValueChange={(next) => setValue(next.value)}
        items={[
          { value: "overview", label: "Overview", content: <Text>Overview</Text> },
          { value: "people", label: "People", count: 4, content: <Text>People</Text> },
        ]}
      />
      <Swatches accent={accent} />
    </Stack>
  );
}

function Mode({ mode }: { mode: "light" | "dark" }) {
  return (
    <Box className={mode} bg="bg.page" color="fg" padding={4} borderRadius="md">
      <Stack gap={3}>
        <Text textStyle="sm" fontWeight="medium">
          {mode}
        </Text>
        <Grid templateColumns="repeat(auto-fit, minmax(240px, 1fr))" gap={3}>
          {PRODUCT_NAMES.map((product) => (
            <ProductScope key={product} product={product}>
              <Surface label={product} />
            </ProductScope>
          ))}
          <ProductScope product={null}>
            <Surface label="Settings" />
          </ProductScope>
        </Grid>
      </Stack>
    </Box>
  );
}

/** Every product and an unscoped surface (Settings) in both modes, tabs and role swatches. */
export const Products: Story = {
  render: () => (
    <Stack gap={4}>
      <Mode mode="light" />
      <Mode mode="dark" />
    </Stack>
  ),
};
