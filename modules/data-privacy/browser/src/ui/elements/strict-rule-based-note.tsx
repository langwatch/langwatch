import { Link } from "@langwatch/browser-host/link";
import { EnterpriseBadge } from "@langwatch/design-system/enterprise-badge";
import { HStack, Text, VStack } from "@langwatch/design-system/primitives";

import {
  ACTIVATE_LICENCE_LINK,
  ASK_ADMIN_FOR_LICENCE,
  type PiiRedactionModelOffer,
  STRICT_RULE_BASED_NOTES,
} from "../../model/pii-redaction-level-offer.ts";

type RuleBasedOffer = Extract<NonNullable<PiiRedactionModelOffer>, { kind: "rule-based" }>;

/** Self-hosted Strict without the model: the reason, and for a missing licence, the advert. */
export function StrictRuleBasedNote({ offer }: { offer: RuleBasedOffer }) {
  if (offer.note !== "licence") {
    return (
      <Text fontSize="xs" color="fg.muted">
        {STRICT_RULE_BASED_NOTES[offer.note]}
      </Text>
    );
  }
  return (
    <VStack align="start" gap={1} data-testid="pii-redaction-model-licence-advert">
      <HStack gap={2} align="start">
        <EnterpriseBadge />
        <Text fontSize="xs" color="fg.muted">
          {STRICT_RULE_BASED_NOTES.licence}
        </Text>
      </HStack>
      {offer.activate ? (
        <Link href={ACTIVATE_LICENCE_LINK.href} fontSize="xs" color="orange.fg">
          {ACTIVATE_LICENCE_LINK.label}
        </Link>
      ) : (
        <Text fontSize="xs" color="fg.muted">
          {ASK_ADMIN_FOR_LICENCE}
        </Text>
      )}
    </VStack>
  );
}
