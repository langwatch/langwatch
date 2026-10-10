import { HStack, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

import {
  type CurrencyPrecision,
  type FormatCurrencyOptions,
  formatCurrency,
  formatCurrencyParts,
} from "../../format-currency.ts";
import { Tooltip } from "../overlays/tooltip.tsx";

export type MoneySize = "xs" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";

/**
 * - `inherit`: the surrounding text's colour.
 * - `muted`: a secondary figure.
 * - `signed`: gains green with a `+`, losses red, zero muted; for deltas and balances.
 */
export type MoneyTone = "inherit" | "muted" | "signed";

export interface MoneyProps {
  amount: number;
  /** ISO 4217 code: `USD`, `EUR`, `JPY`. */
  currency: string;
  /** Defaults to the reader's. */
  locale?: string;
  precision?: CurrencyPrecision;
  currencyDisplay?: FormatCurrencyOptions["currencyDisplay"];
  /** A text style; display sizes (`lg` and up) draw the symbol smaller and muted. */
  size?: MoneySize;
  tone?: MoneyTone;
  /** What the hover shows; defaults to the exact amount, the compact form and the code. */
  tooltip?: ReactNode;
  /** Turns the hover off, for a dense table that repeats the same figure. */
  plain?: boolean;
  "data-testid"?: string;
}

const DISPLAY_SIZES: ReadonlySet<MoneySize> = new Set(["lg", "xl", "2xl", "3xl"]);

function toneColor({ tone, amount }: { tone: MoneyTone; amount: number }): string | undefined {
  if (tone === "muted") return "fg.muted";
  if (tone !== "signed") return undefined;
  if (amount > 0) return "green.fg";
  if (amount < 0) return "red.fg";
  return "fg.muted";
}

/** `US Dollar (USD)`; the bare code where the runtime has no name for it. */
function currencyName({ currency, locale }: { currency: string; locale?: string }): string {
  const name = new Intl.DisplayNames(locale, { type: "currency" }).of(currency);
  return name && name !== currency ? `${name} (${currency})` : currency;
}

/** Every reading of one amount: what the hover lists. */
export function MoneyFormats({
  amount,
  currency,
  locale,
}: {
  amount: number;
  currency: string;
  locale?: string;
}) {
  const rows: [string, string][] = [
    ["Exact", formatCurrency({ amount, currency, locale, precision: "exact" })],
    ["Compact", formatCurrency({ amount, currency, locale, precision: "compact" })],
    ["Currency", currencyName({ currency, locale })],
  ];
  return (
    <VStack align="stretch" gap={0.5} data-testid="money-formats">
      {rows.map(([label, text]) => (
        <HStack key={label} justify="space-between" gap={4}>
          <Text textStyle="2xs">{label}</Text>
          <Text textStyle="xs" fontVariantNumeric="tabular-nums">
            {text}
          </Text>
        </HStack>
      ))}
    </VStack>
  );
}

/**
 * A money amount in its own currency's decimals and the reader's locale. Fractions of
 * a cent stay visible, an amount too small to show reads `< $0.000001`, and the hover
 * gives the exact figure.
 */
export function Money({
  amount,
  currency,
  locale,
  precision = "auto",
  currencyDisplay = "symbol",
  size,
  tone = "inherit",
  tooltip,
  plain = false,
  "data-testid": testId,
}: MoneyProps) {
  const signDisplay = tone === "signed" ? "exceptZero" : "auto";
  const parts = formatCurrencyParts({
    amount,
    currency,
    locale,
    precision,
    currencyDisplay,
    signDisplay,
  });
  const display = size !== undefined && DISPLAY_SIZES.has(size);

  const figure = (
    <Text
      as="span"
      textStyle={size}
      color={toneColor({ tone, amount })}
      whiteSpace="nowrap"
      fontVariantNumeric="tabular-nums"
      cursor={plain ? undefined : "help"}
      aria-label={formatCurrency({
        amount,
        currency,
        locale,
        precision,
        currencyDisplay,
        signDisplay,
      })}
      data-testid={testId}
    >
      {parts.map((part, index) =>
        part.type === "currency" && display ? (
          <Text
            as="span"
            key={`${index}-${part.type}`}
            aria-hidden
            fontSize="0.65em"
            color="fg.muted"
            verticalAlign="0.25em"
          >
            {part.value}
          </Text>
        ) : (
          <span key={`${index}-${part.type}`} aria-hidden>
            {part.value}
          </span>
        ),
      )}
    </Text>
  );

  if (plain) return figure;
  return (
    <Tooltip
      content={tooltip ?? <MoneyFormats amount={amount} currency={currency} locale={locale} />}
    >
      {figure}
    </Tooltip>
  );
}
