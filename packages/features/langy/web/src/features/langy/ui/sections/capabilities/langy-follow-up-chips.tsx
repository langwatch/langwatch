/**
 * Follow-up suggestion chips — the "what do I do with this" row beneath a capability
 * card.
 * @see specs/langy/langy-followup-suggestions.feature
 */
import { HStack } from "@chakra-ui/react";
import { ArrowUpRight } from "lucide-react";
import { LangySpaAnchor } from "../langy-spa-anchor";
import type { FollowUpChip } from "../../../model/capabilities/follow-up-chips";

export function LangyFollowUpChips({ chips }: { chips: FollowUpChip[] }) {
  if (chips.length === 0) return null;

  return (
    <HStack as="nav" aria-label="Suggested next steps" gap={1} flexWrap="wrap" paddingX={0.5}>
      {chips.map((chip) => (
        <LangySpaAnchor
          key={chip.id}
          href={chip.href}
          display="inline-flex"
          alignItems="center"
          gap={1}
          paddingLeft={1.5}
          paddingRight={1}
          paddingY={0.25}
          borderRadius="full"
          borderWidth="1px"
          borderStyle="solid"
          borderColor="border.muted"
          background="transparent"
          color="fg.muted"
          textStyle="2xs"
          fontWeight="500"
          _hover={{
            color: "fg",
            background: "bg.muted",
            borderColor: "border",
            textDecoration: "none",
          }}
        >
          {chip.label}
          <ArrowUpRight size={10} />
        </LangySpaAnchor>
      ))}
    </HStack>
  );
}
