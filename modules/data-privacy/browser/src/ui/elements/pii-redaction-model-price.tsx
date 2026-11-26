import { HStack, IconButton, Text, VStack } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Info } from "lucide-react";

import type { PrivacyBillingCurrency } from "../../model/data-privacy-host.ts";
import {
  piiRedactionModelPriceIn,
  PII_REDACTION_MODEL_PRICE_UNIT,
  STRICT_BILLING_NOTE,
  includedFor,
  strictFallbackNote,
  strictFreeNote,
} from "../../model/pii-redaction-level-offer.ts";

/**
 * "$0.50 per 1M characters excl. VAT, pay as you go" (euros to a euro subscription), or
 * "Included for your organization" when free ("with your Enterprise licence" self-hosted), with
 * the billing and fallback notes behind an (i).
 */
export function PiiRedactionModelPrice({
  free,
  licensed = false,
  split = false,
  currency = "USD",
}: {
  free: boolean;
  licensed?: boolean;
  /** Long spans go to the model in parts (ADR-207): the small print names the split limit. */
  split?: boolean;
  currency?: PrivacyBillingCurrency;
}) {
  return (
    <HStack gap={1.5} wrap="wrap" align="center" data-testid="pii-redaction-model-price">
      <Text fontSize="sm" fontWeight="600">
        {free ? "Included" : piiRedactionModelPriceIn(currency)}
      </Text>
      <Text fontSize="xs" color="fg.muted">
        {free ? includedFor({ licensed }) : PII_REDACTION_MODEL_PRICE_UNIT}
      </Text>
      <Tooltip
        contentProps={{ maxWidth: "320px" }}
        content={
          <VStack align="start" gap={1.5}>
            <Text>{free ? strictFreeNote({ licensed }) : STRICT_BILLING_NOTE}</Text>
            <Text>{strictFallbackNote({ split, free })}</Text>
          </VStack>
        }
      >
        <IconButton
          aria-label={licensed ? "What your license includes" : "How Strict is billed"}
          size="2xs"
          variant="ghost"
          color="fg.muted"
        >
          <Info size={13} />
        </IconButton>
      </Tooltip>
    </HStack>
  );
}
