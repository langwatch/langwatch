import { HStack, IconButton, Text, VStack } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Info } from "lucide-react";

import {
  PII_REDACTION_MODEL_PRICE,
  PII_REDACTION_MODEL_PRICE_UNIT,
  STRICT_BILLING_NOTE,
  STRICT_FALLBACK_NOTE,
  STRICT_FREE_NOTE,
} from "../../model/pii-redaction-level-offer.ts";

/**
 * "$0.50 per 1M characters excl. VAT, pay as you go", or "Included for your organization" when
 * free, with the billing and fallback notes behind an (i).
 */
export function PiiRedactionModelPrice({ free }: { free: boolean }) {
  return (
    <HStack gap={1.5} wrap="wrap" align="center" data-testid="pii-redaction-model-price">
      <Text fontSize="sm" fontWeight="600">
        {free ? "Included" : PII_REDACTION_MODEL_PRICE}
      </Text>
      <Text fontSize="xs" color="fg.muted">
        {free ? "for your organization" : PII_REDACTION_MODEL_PRICE_UNIT}
      </Text>
      <Tooltip
        contentProps={{ maxWidth: "320px" }}
        content={
          <VStack align="start" gap={1.5}>
            <Text>{free ? STRICT_FREE_NOTE : STRICT_BILLING_NOTE}</Text>
            <Text>{STRICT_FALLBACK_NOTE}</Text>
          </VStack>
        }
      >
        <IconButton aria-label="How Strict is billed" size="2xs" variant="ghost" color="fg.muted">
          <Info size={13} />
        </IconButton>
      </Tooltip>
    </HStack>
  );
}
