import { HStack, IconButton, Text, VStack } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Info } from "lucide-react";

import {
  PII_REDACTION_MODEL_PRICE,
  PII_REDACTION_MODEL_PRICE_UNIT,
  STRICT_BILLING_NOTE,
  STRICT_FALLBACK_NOTE,
} from "../../model/pii-redaction-level-offer.ts";

/** "$0.50 per 1M characters, pay as you go", with the billing and fallback notes behind an (i). */
export function PiiRedactionModelPrice() {
  return (
    <HStack gap={1.5} wrap="wrap" align="center" data-testid="pii-redaction-model-price">
      <Text fontSize="sm" fontWeight="600">
        {PII_REDACTION_MODEL_PRICE}
      </Text>
      <Text fontSize="xs" color="fg.muted">
        {PII_REDACTION_MODEL_PRICE_UNIT}
      </Text>
      <Tooltip
        contentProps={{ maxWidth: "320px" }}
        content={
          <VStack align="start" gap={1.5}>
            <Text>{STRICT_BILLING_NOTE}</Text>
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
