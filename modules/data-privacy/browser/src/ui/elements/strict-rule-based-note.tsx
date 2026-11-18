import { EnterpriseLock } from "@langwatch/browser-host/enterprise-lock";
import { Text, VStack } from "@langwatch/design-system/primitives";

import {
  PII_REDACTION_MODEL_NAME,
  type PiiRedactionModelOffer,
  STRICT_RULE_BASED_NOTES,
} from "../../model/pii-redaction-level-offer.ts";

type RuleBasedOffer = Extract<NonNullable<PiiRedactionModelOffer>, { kind: "rule-based" }>;

/** Self-hosted Strict without the model: the reason, and for a missing licence, the lock. */
export function StrictRuleBasedNote({ offer }: { offer: RuleBasedOffer }) {
  const note = (
    <Text fontSize="xs" color="fg.muted">
      {STRICT_RULE_BASED_NOTES[offer.note]}
    </Text>
  );
  if (offer.note !== "licence") return note;
  return (
    <VStack align="start" gap={1} data-testid="pii-redaction-model-licence-advert">
      {note}
      <EnterpriseLock
        variant="line"
        feature={`The ${PII_REDACTION_MODEL_NAME}`}
        description=""
        canManage={offer.activate}
      />
    </VStack>
  );
}
