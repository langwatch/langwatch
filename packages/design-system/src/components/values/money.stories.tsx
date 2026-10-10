import { Stack, Table, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Money, MoneyFormats, type MoneySize } from "./money.tsx";

const meta = {
  title: "Data display/Money",
  parameters: {
    usage: {
      use: "Any money amount: cost, price, balance, spend. The currency's own decimals, the reader's locale, fractions of a cent kept, the exact figure on hover.",
      avoid:
        "`toFixed`, a hand-written `$`, or `formatMoney` (USD and EUR only, ignores the locale). A count or ratio: use Formatted number.",
    },
  },
  component: Money,
  tags: ["autodocs"],
  args: { amount: 1520.75, currency: "USD" },
  argTypes: {
    currency: { control: "inline-radio", options: ["USD", "EUR", "GBP", "JPY", "KWD"] },
    precision: { control: "inline-radio", options: ["auto", "exact", "compact", 0, 2, 4] },
    tone: { control: "inline-radio", options: ["inherit", "muted", "signed"] },
    size: { control: "select", options: ["xs", "sm", "md", "lg", "xl", "2xl", "3xl"] },
    currencyDisplay: {
      control: "inline-radio",
      options: ["symbol", "narrowSymbol", "code", "name"],
    },
  },
} satisfies Meta<typeof Money>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** What a model call costs: the fraction of a cent stays visible. */
export const FractionOfACent: Story = { args: { amount: 0.00042 } };

/** Too small to show at all: a floor, never `$0.00`. */
export const BelowTheFloor: Story = { args: { amount: 0.00000003 } };

export const Zero: Story = { args: { amount: 0 } };

/** Each currency keeps its own decimals: yen none, dinar three. */
export const Currencies: Story = {
  render: () => (
    <Table.Root size="sm" width="360px">
      <Table.Body>
        {["USD", "EUR", "GBP", "JPY", "KWD", "CHF"].map((currency) => (
          <Table.Row key={currency}>
            <Table.Cell>
              <Text textStyle="xs">{currency}</Text>
            </Table.Cell>
            <Table.Cell textAlign="end">
              <Money amount={1234.5678} currency={currency} />
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  ),
};

/** The same amount for readers in different locales: separators and symbol placement move. */
export const Locales: Story = {
  render: () => (
    <Table.Root size="sm" width="360px">
      <Table.Body>
        {["en-US", "en-GB", "de-DE", "fr-FR", "nl-NL", "ja-JP"].map((locale) => (
          <Table.Row key={locale}>
            <Table.Cell>
              <Text textStyle="xs">{locale}</Text>
            </Table.Cell>
            <Table.Cell textAlign="end">
              <Money amount={1234567.891} currency="EUR" locale={locale} />
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  ),
};

/** Text sizes side by side; from `lg` up the symbol steps back. */
export const Sizes: Story = {
  render: () => (
    <Stack gap="2" align="start">
      {(["xs", "sm", "md", "lg", "xl", "2xl", "3xl"] as MoneySize[]).map((size) => (
        <Money key={size} amount={4820.5} currency="USD" size={size} />
      ))}
    </Stack>
  ),
};

/** Tones: inherit, muted, and signed for gains and losses. */
export const Tones: Story = {
  render: () => (
    <Stack gap="1" align="start">
      <Money amount={312.4} currency="USD" />
      <Money amount={312.4} currency="USD" tone="muted" />
      <Money amount={312.4} currency="USD" tone="signed" />
      <Money amount={-87.15} currency="USD" tone="signed" />
      <Money amount={0} currency="USD" tone="signed" />
    </Stack>
  ),
};

export const Precisions: Story = {
  render: () => (
    <Stack gap="1" align="start">
      <Money amount={1234567.891} currency="USD" precision="auto" />
      <Money amount={1234567.891} currency="USD" precision="compact" />
      <Money amount={0.000123456} currency="USD" precision="exact" />
      <Money amount={19.999} currency="USD" precision={0} />
    </Stack>
  ),
};

/** What the hover shows. */
export const Formats: Story = {
  render: () => <MoneyFormats amount={0.0004213} currency="USD" />,
};
