import { Badge, Box } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { SummaryList, SummaryListItem } from "./summary-list.tsx";

const meta = {
  title: "Data display/Summary list",
  component: SummaryList,
  tags: ["autodocs"],
  parameters: {
    usage: {
      use: "Compact read-only properties using SummaryListItem children. Null, absent and empty string values become an em dash; chips and formatted values are accepted as children.",
      avoid:
        "Editable fields or large comparable datasets: use form controls or a table. Put the section heading outside the list.",
    },
  },
  args: {
    children: (
      <>
        <SummaryListItem label="Identity provider">Acme Workforce</SummaryListItem>
        <SummaryListItem label="Issuer" />
        <SummaryListItem label="Join policy">
          <Badge>Administrator approval</Badge>
        </SummaryListItem>
        <SummaryListItem label="Members">0</SummaryListItem>
      </>
    ),
  },
} satisfies Meta<typeof SummaryList>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Narrow: Story = {
  decorators: [
    (Story) => (
      <Box width="240px">
        <Story />
      </Box>
    ),
  ],
  args: {
    children: (
      <SummaryListItem label="Issuer">
        https://identity.example.com/organizations/international-workforce
      </SummaryListItem>
    ),
  },
};
