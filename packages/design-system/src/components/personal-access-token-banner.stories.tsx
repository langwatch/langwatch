import type { Meta, StoryObj } from "@storybook/react-vite";

import { PersonalAccessTokenBanner } from "./personal-access-token-banner.tsx";

const meta = {
  title: "Components/Personal access token banner",
  component: PersonalAccessTokenBanner,
  tags: ["autodocs"],
  args: { token: null, isCreating: false, onCreate: () => void 0 },
} satisfies Meta<typeof PersonalAccessTokenBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BeforeCreate: Story = {};

export const Created: Story = {
  args: { token: "pat-lw-example-token" },
};
