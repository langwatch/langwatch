/**
 * Follow-up suggestion chips — the "what do I do with this" row beneath a
 * capability card.
 *
 * A capability card answers "what did Langy find"; these chips answer "what is
 * that result worth doing next". WHICH offers to make is `cliFollowUps.ts`'s job
 * (driven by the feature map's produces/consumes relation); WHERE each offer
 * lands is `logic/traceQueryIntent.ts`'s (it recompiles the search into a
 * destination URL). `LangyCapabilityRenderer` joins the two and hands the
 * already-resolved chips here — this component only draws them.
 *
 * Two rules it holds to, both from the spec:
 *
 *   THEY READ AS OFFERS, NOT AS DONE THINGS. The chips are deliberately quiet —
 *   a hairline pill in muted foreground — so they sit UNDER the card and never
 *   compete with the card's own bright "Open in <surface>" link. A suggestion is
 *   subordinate to the result it hangs off.
 *
 *   CHOOSING ONE ONLY NAVIGATES. Every chip is a plain link to a destination
 *   that arrives pre-filtered; following one creates, mutates or persists
 *   nothing. The offer becomes an action only once the user lands on the surface
 *   and acts there, which keeps the catalogue's propose-then-apply rule intact.
 *
 * Renders NOTHING when there are no offers, so a card with no worthwhile next
 * step shows no empty chip row.
 *
 * @see specs/langy/langy-followup-suggestions.feature
 */
import { HStack } from "@chakra-ui/react";
import { ArrowUpRight } from "lucide-react";
import { LangySpaAnchor } from "../LangySpaAnchor";
import type { FollowUpChip } from "./followUpChips";

export function LangyFollowUpChips({ chips }: { chips: FollowUpChip[] }) {
  if (chips.length === 0) return null;

  return (
    <HStack
      as="nav"
      aria-label="Suggested next steps"
      gap={1}
      flexWrap="wrap"
      paddingX={0.5}
    >
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
