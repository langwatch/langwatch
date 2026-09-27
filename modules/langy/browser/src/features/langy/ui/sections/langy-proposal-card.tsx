import { Box, Button, chakra, HStack, Text } from "@chakra-ui/react";
import { isInternalHref } from "@langwatch/browser-host/markdown";
import { useRouter } from "@langwatch/browser-host/use-router";
import { LANGY_ACTION_SHADOW, LangyMeshLayer } from "@langwatch/langy-browser-kit";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import type { KeyboardEvent, MouseEvent } from "react";

import { useSpaLinkClick } from "../../behavior/logic/spa-link.ts";

export interface LangyProposal {
  langyProposal: true;
  kind: string;
  summary: string;
  rationale?: string;
  destructive?: boolean;
  payload: Record<string, unknown>;
}

export type AppliedOutcome =
  | {
      label?: string;
      onOpen?: () => void;
      href?: string;
    }
  | undefined;

export type ProposalHandlers = Record<
  string,
  (payload: Record<string, unknown>) => Promise<AppliedOutcome>
>;

type AppliedOutcomeValue = NonNullable<AppliedOutcome>;

type ProposalState = {
  isApplied: boolean;
  isDiscarded: boolean;
  isApplying: boolean;
  destructive: boolean;
};

/** The overline's words, one state at a time. */
function proposalOverlineLabel({ isApplied, isDiscarded, isApplying, destructive }: ProposalState) {
  if (isApplied) return destructive ? "Done" : "Applied";
  if (isDiscarded) return "Discarded";
  if (isApplying) return destructive ? "Deleting…" : "Applying…";
  return destructive ? "Wants to delete" : "Proposal";
}

/** The overline's colour: red for a pending delete, green once applied, muted once discarded. */
function proposalOverlineColor({ isApplied, isDiscarded, destructive }: ProposalState) {
  if (destructive && !isApplied) return "var(--chakra-colors-red-fg)";
  if (isApplied && !destructive) return "var(--chakra-colors-green-fg)";
  if (isDiscarded) return "var(--chakra-colors-fg-muted)";
  return "var(--chakra-colors-purple-fg)";
}

/** What the proposal's primary button says, before and during the action. */
function proposalActionLabel({
  isApplying,
  destructive,
}: {
  isApplying: boolean;
  destructive: boolean;
}) {
  if (isApplying) return destructive ? "Deleting\u2026" : "Applying\u2026";
  return destructive ? "Delete" : "Apply";
}

/** A click or key that landed on a link or button inside the card belongs to that control. */
function landedOnControl(target: EventTarget): boolean {
  return target instanceof Element && target.closest("a, button") !== null;
}

/**
 * Opening what an applied proposal made: its own opener, or its link. An in-app destination is
 * an SPA route, so the Langy panel stays mounted; an external one gets a real navigation.
 */
function useProposalOpen(appliedOutcome: AppliedOutcomeValue | undefined) {
  const router = useRouter();
  const openHref = appliedOutcome?.href;
  const onOpen = appliedOutcome?.onOpen;
  const onOpenHrefClick = useSpaLinkClick(openHref ?? "");
  const triggerOpen = () => {
    if (onOpen) {
      onOpen();
      return;
    }
    if (!openHref) return;
    if (isInternalHref(openHref)) void router.push(openHref);
    else window.location.href = openHref;
  };
  return {
    hasOpen: !!onOpen || !!openHref,
    openHref,
    onOpen,
    openLabel: appliedOutcome?.label ?? "Open",
    onOpenHrefClick,
    triggerOpen,
  };
}

type ProposalOpen = ReturnType<typeof useProposalOpen>;

/**
 * The whole card as a button once it opens something, so keyboard and screen-reader users reach
 * the affordance too; the inner Open button stays the explicit fallback.
 */
function openableCardProps({ open, summary }: { open: ProposalOpen; summary: string }) {
  if (!open.hasOpen) return {};
  return {
    role: "button",
    tabIndex: 0,
    "aria-label": `${open.openLabel}: ${summary}`,
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (landedOnControl(event.target)) return;
      event.preventDefault();
      open.triggerOpen();
    },
    onClick: (event: MouseEvent<HTMLDivElement>) => {
      if (!landedOnControl(event.target)) open.triggerOpen();
    },
  };
}

export function ProposalCard({
  proposal,
  appliedOutcome,
  isDiscarded,
  isApplying,
  onApply,
  onDiscard,
}: {
  proposal: LangyProposal;
  appliedOutcome?: AppliedOutcomeValue;
  isDiscarded: boolean;
  isApplying: boolean;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const isApplied = !!appliedOutcome;
  const destructive = !!proposal.destructive;
  const open = useProposalOpen(appliedOutcome);
  const state = { isApplied, isDiscarded, isApplying, destructive };
  return (
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding={3}
      background="bg.subtle"
      opacity={isDiscarded ? 0.65 : 1}
      cursor={open.hasOpen ? "pointer" : "default"}
      {...openableCardProps({ open, summary: proposal.summary })}
      transition="border-color 150ms ease, box-shadow 150ms ease"
      _hover={open.hasOpen ? { borderColor: "green.fg", boxShadow: "sm" } : undefined}
    >
      <HStack
        gap={1.5}
        marginBottom={2}
        textStyle="2xs"
        fontWeight="600"
        letterSpacing="0.08em"
        textTransform="uppercase"
        color={proposalOverlineColor(state)}
      >
        {isApplied && !destructive ? <Check size={11} /> : <Sparkles size={11} />}
        <Text>{proposalOverlineLabel(state)}</Text>
      </HStack>
      <Text textStyle="sm" fontWeight="600" color="fg" marginBottom={0.5}>
        {proposal.summary}
      </Text>
      {proposal.rationale ? (
        <Text textStyle="xs" color="fg.muted" lineHeight="1.45" marginBottom={3}>
          {proposal.rationale}
        </Text>
      ) : null}
      {!isApplied && !isDiscarded ? (
        <ProposalDecision
          destructive={destructive}
          isApplying={isApplying}
          hasRationale={!!proposal.rationale}
          onApply={onApply}
          onDiscard={onDiscard}
        />
      ) : null}
      {isApplied && open.hasOpen ? <ProposalOpenAction open={open} /> : null}
    </Box>
  );
}

/** Apply (or the red confirm of a delete) beside Discard, while the proposal is undecided. */
function ProposalDecision({
  destructive,
  isApplying,
  hasRationale,
  onApply,
  onDiscard,
}: {
  destructive: boolean;
  isApplying: boolean;
  hasRationale: boolean;
  onApply: () => void;
  onDiscard: () => void;
}) {
  return (
    <HStack gap={1.5} paddingTop={hasRationale ? 0 : 2.5}>
      <chakra.button
        type="button"
        flex={1}
        paddingX={3}
        paddingY={2}
        borderRadius="md"
        borderWidth={0}
        background={destructive ? "var(--chakra-colors-red-solid)" : "transparent"}
        color="white"
        fontSize="sm"
        fontWeight={500}
        cursor={isApplying ? "default" : "pointer"}
        opacity={isApplying ? 0.7 : 1}
        display="flex"
        alignItems="center"
        justifyContent="center"
        gap={1.5}
        boxShadow={destructive ? undefined : LANGY_ACTION_SHADOW}
        onClick={onApply}
        disabled={isApplying}
        position="relative"
        overflow="hidden"
      >
        {destructive ? null : <LangyMeshLayer borderRadius="md" active={isApplying} />}
        <Box position="relative" zIndex={1} display="flex" alignItems="center" gap={1.5}>
          <Check size={12} />
          {proposalActionLabel({ isApplying, destructive })}
        </Box>
      </chakra.button>
      <Button size="xs" variant="outline" onClick={onDiscard} disabled={isApplying}>
        {destructive ? "Cancel" : "Discard"}
      </Button>
    </HStack>
  );
}

/** The way into what an applied proposal made: its opener, else its link. */
function ProposalOpenAction({ open }: { open: ProposalOpen }) {
  if (open.onOpen) {
    return (
      <HStack paddingTop={2.5}>
        <Button size="xs" variant="outline" colorPalette="green" onClick={open.triggerOpen}>
          {open.openLabel}
          <ArrowRight size={12} />
        </Button>
      </HStack>
    );
  }
  return (
    <HStack paddingTop={2.5}>
      <Button size="xs" variant="outline" colorPalette="green" asChild>
        <a href={open.openHref} onClick={open.onOpenHrefClick}>
          {open.openLabel}
          <ArrowRight size={12} />
        </a>
      </Button>
    </HStack>
  );
}
