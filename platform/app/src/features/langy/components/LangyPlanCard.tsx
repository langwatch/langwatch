/**
 * The plan checklist — the spine of a multi-step turn.
 *
 * When a turn's message carries a `todowrite` plan (folded by `langyPlan`), this
 * card replaces the flat activity list: the steps render as a checklist, and the
 * tool/capability cards that ran under each step nest beneath it. The rules the
 * design plan sets:
 *
 *   - completed → green check, one collapsed line (click to re-expand its work);
 *   - in-progress → pulsing dot + the brand shimmer, EXPANDED with its nested
 *     cards; the only step whose work is shown by default while the turn runs;
 *   - pending → dimmed, no dot;
 *   - cancelled → struck through, dimmed, and NOT counted toward the total.
 *
 * The card is a compact live receipt by default: progress plus the current
 * step. Clicking it reveals the whole checklist and its historical work. A
 * settled-but-incomplete turn (a failure/handoff) freezes honestly: nothing
 * pulses and no step is invented.
 *
 * Reduced motion: the pulse and the shimmer sweep drop to a static treatment.
 */
import { Box, chakra, HStack, Text, VStack } from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import { Check, ChevronRight } from "lucide-react";
import { useState } from "react";
import { LangyCard } from "~/features/asaplangy";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import type { LangyPlan, LangyPlanItem } from "../logic/langyPlan";
import { LangyActivityParts } from "./LangyToolActivity";
import { langyThinkingShimmerStyles } from "./langyShimmer";

const dotPulse = keyframes`
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.4; transform: scale(0.72); }
`;

export function LangyPlanCard({
  plan,
  reasoningTitles = [],
  isStreaming = false,
}: {
  plan: LangyPlan;
  /**
   * The turn's folded reasoning-summary headlines (logic/langyReasoningTitles).
   * When a plan ran, this card IS the settled turn's process record, so the
   * headlines ride its expanded checklist the same way they ride the
   * completed-actions receipt: quiet rows that claim thought, not work.
   */
  reasoningTitles?: string[];
  /** The live, in-flight turn — only then does the current step pulse. */
  isStreaming?: boolean;
}) {
  const reduce = useReducedMotion();
  // A plan is a small status receipt first; the checklist is available on
  // demand. This keeps a three-step task from becoming the whole conversation.
  const [cardOpen, setCardOpen] = useState(false);
  const currentItem =
    plan.currentIndex >= 0 ? plan.items[plan.currentIndex] : undefined;

  // The plan is a `progress` card in the taxonomy (asaplangy CARD_TAXONOMY): the
  // thing you asked for is under way. LangyCard renders the intent's material —
  // the same hairline surface and 13/10 padding this card always used — so the
  // plan reads at the right attention weight without hand-rolling the box. Its
  // own live pulse lives on the current PlanStep, not the card's status dot.
  return (
    <LangyCard intent="progress" aria-label="Langy plan">
      <PlanOverline
        completed={plan.completedCount}
        total={plan.totalCount}
        onToggle={() => setCardOpen((value) => !value)}
        expanded={cardOpen}
      />

      {cardOpen ? (
        <>
          {plan.preamble.length > 0 ? (
            <LangyActivityParts parts={plan.preamble} />
          ) : null}
          <VStack align="stretch" gap={1.5} role="list">
            {plan.items.map((item, index) => (
              <PlanStep
                key={`${index}:${item.content}`}
                item={item}
                isCurrent={index === plan.currentIndex}
                isStreaming={isStreaming}
                nestedParts={plan.itemParts[index] ?? []}
                reduce={reduce}
              />
            ))}
          </VStack>
          {reasoningTitles.length > 0 ? (
            // The thinking steps the model narrated between calls: part of
            // the turn's process record, so they live in the same expanded
            // area as the steps, quieter (they claim thought, not work).
            <VStack align="stretch" gap={0} role="list">
              {reasoningTitles.map((title, index) => (
                <Text
                  key={`thought-${index}`}
                  role="listitem"
                  textStyle="xs"
                  color="fg.subtle"
                  fontStyle="italic"
                  paddingY={1.5}
                  truncate
                  title={title}
                >
                  {title}
                </Text>
              ))}
            </VStack>
          ) : null}
        </>
      ) : currentItem ? (
        <PlanStep
          item={currentItem}
          isCurrent
          isStreaming={isStreaming}
          nestedParts={plan.itemParts[plan.currentIndex] ?? []}
          reduce={reduce}
        />
      ) : null}
    </LangyCard>
  );
}

/** The compact "PLAN · 3 OF 7 · 4 LEFT" status and detail toggle. */
function PlanOverline({
  completed,
  total,
  onToggle,
  expanded,
}: {
  completed: number;
  total: number;
  onToggle: () => void;
  expanded: boolean;
}) {
  const left = Math.max(0, total - completed);
  const label = `Plan · ${completed} of ${total} · ${
    left === 0 ? "done" : `${left} left`
  }`;

  const content = (
    <HStack gap={1.5} align="center">
      {left === 0 ? (
        <Box color="green.fg" display="flex" flexShrink={0}>
          <Check size={11} />
        </Box>
      ) : null}
      <Text
        textStyle="2xs"
        fontWeight="600"
        letterSpacing="0.08em"
        textTransform="uppercase"
        color={left === 0 ? "green.fg" : "fg.subtle"}
        truncate
        flex={1}
        minWidth={0}
      >
        {label}
      </Text>
      <Box
        as="span"
        color="fg.subtle"
        transition="transform 0.18s ease"
        transform={expanded ? "rotate(90deg)" : undefined}
        flexShrink={0}
        display="flex"
      >
        <ChevronRight size={12} />
      </Box>
    </HStack>
  );

  return (
    <chakra.button
      type="button"
      width="full"
      textAlign="left"
      cursor="pointer"
      aria-expanded={expanded}
      onClick={onToggle}
      _focusVisible={{
        outline: "2px solid",
        outlineColor: "orange.solid",
        outlineOffset: "2px",
        borderRadius: "4px",
      }}
    >
      {content}
    </chakra.button>
  );
}

function PlanStep({
  item,
  isCurrent,
  isStreaming,
  nestedParts,
  reduce,
}: {
  item: LangyPlanItem;
  isCurrent: boolean;
  isStreaming: boolean;
  nestedParts: readonly unknown[];
  reduce: boolean;
}) {
  const hasNested = nestedParts.length > 0;
  // The current step opens its work by default; a completed step is a line you
  // can click open. A pending/cancelled step has nothing to open.
  const canExpand = hasNested && !isCurrent;
  const [open, setOpen] = useState(false);
  const showNested = hasNested && (isCurrent || open);

  const pulsing = isCurrent && isStreaming;
  const shimmer = reduce
    ? { ...langyThinkingShimmerStyles, animation: "none" }
    : langyThinkingShimmerStyles;

  const marker =
    item.status === "completed" ? (
      <Box color="green.fg" display="flex" flexShrink={0} width="12px">
        <Check size={11} />
      </Box>
    ) : item.status === "in_progress" ? (
      <Box width="12px" display="flex" justifyContent="center" flexShrink={0}>
        <Box
          width="6px"
          height="6px"
          borderRadius="full"
          background="orange.solid"
          css={
            pulsing
              ? { animation: `${dotPulse} 1.4s ease-in-out infinite` }
              : undefined
          }
        />
      </Box>
    ) : (
      <Box width="12px" flexShrink={0} />
    );

  const rowText = (
    <Text
      textStyle="sm"
      lineHeight="1.35"
      flex={1}
      minWidth={0}
      fontWeight={item.status === "in_progress" ? "640" : "500"}
      color={
        item.status === "completed"
          ? "fg"
          : item.status === "pending"
            ? "fg.muted"
            : item.status === "cancelled"
              ? "fg.subtle"
              : undefined
      }
      textDecoration={item.status === "cancelled" ? "line-through" : undefined}
      css={pulsing ? shimmer : undefined}
    >
      {item.content}
    </Text>
  );

  const header = (
    <HStack gap={2} align="center">
      {marker}
      {rowText}
      {canExpand ? (
        <Box
          as="span"
          color="fg.subtle"
          transition="transform 0.18s ease"
          transform={open ? "rotate(90deg)" : undefined}
          flexShrink={0}
          display="flex"
        >
          <ChevronRight size={12} />
        </Box>
      ) : null}
    </HStack>
  );

  return (
    <Box role="listitem">
      {canExpand ? (
        <chakra.button
          type="button"
          width="full"
          textAlign="left"
          cursor="pointer"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          _focusVisible={{
            outline: "2px solid",
            outlineColor: "orange.solid",
            outlineOffset: "2px",
            borderRadius: "4px",
          }}
        >
          {header}
        </chakra.button>
      ) : (
        header
      )}
      {showNested ? (
        <Box paddingLeft="20px" paddingTop={2}>
          <LangyActivityParts parts={nestedParts} />
        </Box>
      ) : null}
    </Box>
  );
}
