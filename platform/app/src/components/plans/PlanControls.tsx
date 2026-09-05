import { Box, Button, HStack } from "@chakra-ui/react";
import { DollarSign, Euro } from "lucide-react";
import { SHAPE } from "~/features/auth/authTheme";
import { Currency as PrismaCurrency } from "~/generated/prisma/client";
import type { BillingInterval, Currency } from "../subscription/billing-plans";

const BILLING_PERIODS: ReadonlyArray<{
  label: string;
  value: BillingInterval;
}> = [
  { label: "Monthly", value: "monthly" },
  { label: "Annually", value: "annual" },
];

/**
 * The two switches that change what the figures say, sat together as one
 * cluster on the masthead's right.
 *
 * They used to sit on their own row under the title, centred between two empty
 * spacers — three columns of layout to hold two controls. Beside the heading
 * they read as what they are: the settings for the row underneath.
 */
export function PlanControls({
  billingPeriod,
  onBillingPeriodChange,
  currency,
  onCurrencyChange,
}: {
  billingPeriod: BillingInterval;
  onBillingPeriodChange: (billingPeriod: BillingInterval) => void;
  currency: Currency;
  onCurrencyChange: (currency: Currency) => void;
}) {
  return (
    <HStack gap={2} flexWrap="wrap">
      <HStack
        gap={0}
        backgroundColor="bg.muted"
        borderRadius="full"
        borderWidth={1}
        borderColor="border.subtle"
        padding="3px"
        data-testid="billing-period-toggle"
      >
        {BILLING_PERIODS.map((option) => {
          const isSelected = billingPeriod === option.value;
          return (
            <Box
              key={option.value}
              as="button"
              aria-pressed={isSelected}
              onClick={() => onBillingPeriodChange(option.value)}
              paddingInline={4}
              paddingBlock="5px"
              borderRadius="full"
              fontSize="13px"
              fontWeight={isSelected ? "600" : "500"}
              color={isSelected ? "auth.ink" : "fg.muted"}
              backgroundColor={isSelected ? "bg.panel" : "transparent"}
              boxShadow={isSelected ? "xs" : "none"}
              transition="color 150ms ease, background-color 150ms ease"
              cursor="pointer"
              _hover={{ color: isSelected ? "auth.ink" : "fg" }}
              _focusVisible={{
                outline: "2px solid",
                outlineColor: "auth.detail",
                outlineOffset: "1px",
              }}
            >
              {option.label}
            </Box>
          );
        })}
      </HStack>

      <Button
        data-testid="currency-toggle"
        variant="outline"
        size="sm"
        height="34px"
        borderRadius={SHAPE.action}
        borderColor="border.emphasized"
        color="fg.muted"
        fontSize="13px"
        fontWeight="600"
        _hover={{ color: "auth.ink", borderColor: "auth.detail" }}
        _focusVisible={{
          outline: "2px solid",
          outlineColor: "auth.detail",
          outlineOffset: "2px",
        }}
        onClick={() =>
          onCurrencyChange(
            currency === PrismaCurrency.EUR
              ? PrismaCurrency.USD
              : PrismaCurrency.EUR,
          )
        }
      >
        {currency === PrismaCurrency.EUR ? (
          <Euro size={14} />
        ) : (
          <DollarSign size={14} />
        )}
        {currency}
      </Button>
    </HStack>
  );
}
