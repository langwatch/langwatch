import type { PiiLevel } from "@langwatch/data-privacy-contract";
import { Card } from "@langwatch/design-system/card";
import { Badge, HStack, Text, VStack } from "@langwatch/design-system/primitives";

import {
  ESSENTIAL_MISSES,
  organizationPiiLevel,
  PII_REDACTION_MODEL_NAME,
} from "../../model/pii-redaction-level-offer.ts";
import { PiiRedactionExample } from "../elements/pii-redaction-example.tsx";
import { PiiRedactionModelPrice } from "../elements/pii-redaction-model-price.tsx";

/** In the rule drawer: what the rule's level runs, Strict's price, and what it stores. */
export function PiiRedactionLevelDetail({ level }: { level: PiiLevel }) {
  const shown = organizationPiiLevel(level);
  if (!shown) return null;
  return (
    <VStack align="stretch" gap={2}>
      <HStack gap={2} wrap="wrap">
        <Text fontSize="xs" color="fg.muted">
          Runs
        </Text>
        {shown === "strict" ? (
          <>
            <Badge size="sm" variant="subtle" colorPalette="green">
              {PII_REDACTION_MODEL_NAME}
            </Badge>
            <PiiRedactionModelPrice />
          </>
        ) : (
          <Badge size="sm" variant="subtle" colorPalette="gray">
            Standard detection · included
          </Badge>
        )}
      </HStack>
      <Text fontSize="xs" color="fg.muted">
        {shown === "strict"
          ? "Names and street addresses are masked too."
          : `${ESSENTIAL_MISSES}. Strict does.`}
      </Text>
      <Card variant="nested" padding="sm">
        <PiiRedactionExample level={shown} />
      </Card>
    </VStack>
  );
}
