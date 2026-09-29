import {
  Button,
  createListCollection,
  Flex,
  Heading,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Link } from "@langwatch/browser-host/link";
import { Select } from "@langwatch/design-system/select";
import { Currency as PrismaCurrency } from "@langwatch/enterprise-billing-contract";
import { ArrowRight } from "lucide-react";

import type { BillingInterval, Currency } from "../../model/billing-plans.ts";
import { LabeledSwitch } from "../../ui/elements/labeled-switch.tsx";

const currencyOptions: { label: string; value: Currency }[] = [
  { label: "€ EUR", value: PrismaCurrency.EUR },
  { label: "$ USD", value: PrismaCurrency.USD },
];
const currencyCollection = createListCollection({ items: currencyOptions });

/** The billing heading, and the period and currency pickers while a plan is still being chosen. */
export function SubscriptionPageHeader({
  showPlanPickers,
  billingPeriod,
  onBillingPeriodChange,
  currency,
  onCurrencyChange,
}: {
  showPlanPickers: boolean;
  billingPeriod: BillingInterval;
  onBillingPeriodChange: (period: BillingInterval) => void;
  currency: Currency;
  onCurrencyChange: (currency: Currency) => void;
}) {
  return (
    <Flex justifyContent="space-between" alignItems="flex-start">
      <VStack align="start" gap={1}>
        <Heading size="xl">Billing</Heading>
        <Text color="fg.muted">
          For questions about billing,{" "}
          <Link
            href="mailto:sales@langwatch.ai"
            fontWeight="semibold"
            color="fg"
            _hover={{ color: "fg" }}
          >
            contact us
          </Link>
        </Text>
      </VStack>
      <HStack gap={4} alignItems="center">
        {showPlanPickers && (
          <>
            <LabeledSwitch
              data-testid="billing-period-toggle"
              left={{ label: "Monthly", value: "monthly" }}
              right={{ label: "Annually", value: "annual" }}
              value={billingPeriod}
              onChange={onBillingPeriodChange}
            />
            <Select.Root
              data-testid="currency-selector"
              collection={currencyCollection}
              size="xs"
              width="100px"
              value={[currency]}
              onValueChange={(details) => {
                const selected = currencyOptions.find(
                  (option) => option.value === details.value[0],
                );
                if (selected) onCurrencyChange(selected.value);
              }}
            >
              <Select.Trigger>
                <Select.ValueText />
              </Select.Trigger>
              <Select.Content paddingY={2}>
                {currencyOptions.map((option) => (
                  <Select.Item key={option.value} item={option}>
                    {option.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </>
        )}
        <Link href="/settings/plans">
          <Button variant="ghost" size="sm" color="fg.muted">
            All plans <ArrowRight size={14} />
          </Button>
        </Link>
      </HStack>
    </Flex>
  );
}
