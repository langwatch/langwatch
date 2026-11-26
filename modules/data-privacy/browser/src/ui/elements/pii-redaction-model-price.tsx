import { HStack, IconButton, Text, VStack } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Info } from "lucide-react";

import {
  type PiiRedactionModel,
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
export function PiiRedactionModelPrice({ model }: { model: PiiRedactionModel }) {
  const { free, split } = model;
  const licensed = model.free && model.licensed;
  return (
    <HStack gap={1.5} wrap="wrap" align="center" data-testid="pii-redaction-model-price">
      <Text fontSize="sm" fontWeight="600">
        {model.free ? "Included" : piiRedactionModelPriceIn(model.currency)}
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
