import { Badge, Box } from "@chakra-ui/react";
import { nowInstant } from "@langwatch/time";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Globe } from "lucide-react";

import { FormattedDate } from "../values/formatted-date.tsx";
import { ResourceRow } from "./resource-row.tsx";

const meta = {
  title: "Data display/Resource row",
  component: ResourceRow,
  tags: ["autodocs"],
  parameters: {
    usage: {
      use: "A resource's name, status, explanation and provenance in a compact outlined row. Supply resolved names and compose FormattedDate in meta. All slots are presentational.",
      avoid:
        "Whole-page cards or navigation: use Card or a link. Fetching, permissions and user identity resolution stay in the feature.",
    },
  },
  args: {
    name: "acme.example",
    icon: <Globe size={16} />,
    status: <Badge colorPalette="green">Verified</Badge>,
    description: "Published record",
    meta: (
      <>
        Verified by Olive Admin · olive@acme.example ·{" "}
        <FormattedDate value={nowInstant().epochMilliseconds - 300_000} display="relative" />
      </>
    ),
  },
} satisfies Meta<typeof ResourceRow>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Pending: Story = {
  args: {
    status: <Badge colorPalette="orange">Awaiting verification</Badge>,
    description: null,
    meta: null,
  },
};
export const Narrow: Story = {
  decorators: [
    (Story) => (
      <Box width="260px">
        <Story />
      </Box>
    ),
  ],
  args: { name: "international-workforce.identity.acme.example" },
};
