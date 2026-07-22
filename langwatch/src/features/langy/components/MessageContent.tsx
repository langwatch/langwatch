import { Box, Button, chakra, HStack, Text, VStack } from "@chakra-ui/react";
import type {
  LangyDerivedChoicesCard,
  LangyChoiceSelection,
  LangyDerivedCard,
  LangyChoicesTimelineEntry,
} from "@langwatch/langy";
import { deriveLangyChoicesLockState } from "@langwatch/langy";
import type { UIMessage } from "ai";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { memo, useMemo } from "react";
import type React from "react";
import { isInternalHref, Markdown } from "~/components/Markdown";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRouter } from "~/utils/compat/next-router";
import { LANGY_ACTION_SHADOW, LangyMeshLayer } from "./LangyMark";
import { githubPrsFromToolParts } from "~/shared/langy/githubPrCard";
import { githubProgressFromToolParts } from "~/server/app-layer/langy/execution/githubCommand";
import { LangyGitHubPrCard } from "./github/LangyGitHubPrCard";
import { LangyGitHubProgressCard } from "./github/LangyGitHubProgressCard";
import {
  isSubstantiveLangyAnswer,
  parseLangyFeedbackDirective,
} from "../logic/langyFeedbackDirective";
import {
  hasLangyBlockParts,
  langyAnswerSegments,
  type LangyAnswerSegment,
} from "../logic/langyAnswerSegments";
import { LangyDerivedCardView } from "./derived-cards/LangyDerivedCardView";
import { StreamingAnswerWithCards } from "./derived-cards/StreamingAnswerWithCards";
import { LangyFailedCard } from "./derived-cards/LangyFailedCard";
import { LangyCardBoundary } from "./LangyCardBoundary";
import { LangyFeedback } from "./LangyFeedback";
import { hasLangyActivity, LangyToolActivity } from "./LangyToolActivity";
import { LangyPlanCard } from "./LangyPlanCard";
import { langyPlan } from "../logic/langyPlan";
import { questionToolCardParts } from "../logic/langyQuestionTool";
import { stripToolNarration } from "../logic/langyToolNarration";
import { useLangyStore } from "../stores/langyStore";
import { StreamingText } from "./StreamingText";

export interface LangyProposal {
  langyProposal: true;
  kind: string;
  summary: string;
  rationale?: string;
  destructive?: boolean;
  payload: Record<string, unknown>;
}

export type AppliedOutcome = {
  label?: string;
  onOpen?: () => void;
  href?: string;
} | void;

export type ProposalHandlers = Record<
  string,
  (payload: Record<string, unknown>) => Promise<AppliedOutcome>
>;

function MessageContentImpl({
  message,
  organizationId,
  appliedOutcomes,
  discardedProposals,
  applyingProposals,
  onApply,
  onDiscard,
  isStreaming = false,
  conversationId,
  showFeedback = false,
  shouldAskFeedback = false,
  isFeedbackPinned = false,
  choicesTimeline,
  onChoiceSelect,
  onVerifyDerivedCard,
}: {
  message: UIMessage;
  organizationId?: string | null;
  appliedOutcomes: Record<
    string,
    { href?: string; label?: string; onOpen?: () => void }
  >;
  discardedProposals: Set<string>;
  applyingProposals: Set<string>;
  onApply: (proposalId: string, proposal: LangyProposal) => Promise<void>;
  onDiscard: (proposalId: string) => void;
  /** True for the in-flight assistant turn — streams tokens with blur reveal. */
  isStreaming?: boolean;
  /** Active conversation id, so feedback can attach to it. */
  conversationId?: string | null;
  /**
   * Position + settled gate: this is the latest assistant reply and nothing is
   * in flight, so a feedback card MAY sit here. Whether one does is decided by
   * `shouldAskFeedback` / the directive / `isFeedbackPinned`.
   */
  showFeedback?: boolean;
  /** The backend cadence's verdict: ask under this settled answer. */
  shouldAskFeedback?: boolean;
  /** Pinned open — a shown card riding out refetches, or `/feedback`. */
  isFeedbackPinned?: boolean;
  /**
   * The ordered conversation timeline the choices lock state derives from
   * (ADR-060 §6). Absent = every choices card renders closed (fail-closed:
   * a question is never answerable without the record to derive that from).
   */
  choicesTimeline?: LangyChoicesTimelineEntry[];
  /** Answer a choices card. Absent = read-only (time travel, shared views). */
  onChoiceSelect?: (a: {
    selection: LangyChoiceSelection;
    card: LangyDerivedChoicesCard;
  }) => void;
  /** Bind a derived card's verify hint. Absent = chip hidden. */
  onVerifyDerivedCard?: (a: { card: LangyDerivedCard }) => void;
}) {
  const isUser = message.role === "user";
  const { project } = useOrganizationTeamProject();
  const rawText = message.parts
    .filter(
      (part): part is { type: "text"; text: string } => part.type === "text",
    )
    .map((part) => part.text)
    .join("");

  // The block channel (ADR-060): a settled assistant message whose parts
  // carry stamped `langy-card` / `langy-card-failed` parts renders as an
  // ORDERED sequence — prose, card where the block sat, prose — instead of
  // one joined markdown body. Fence-less messages keep the joined path
  // untouched, and the live streaming turn never has stamped parts (the
  // preview is Phase 4's seam), so `isStreaming` rendering is unaffected.
  // Memoized: parts are replaced wholesale on settle/rehydrate, so identity
  // is a faithful cache key and history messages never re-split per render.
  const blockSegments = useMemo(
    () =>
      !isUser && !isStreaming && hasLangyBlockParts(message.parts)
        ? langyAnswerSegments(message.parts)
        : null,
    [isUser, isStreaming, message.parts],
  );

  // The agent's `question` TOOL call, mapped onto the choices contract
  // (langyQuestionTool.ts) and rendered through the same card path a stamped
  // choices block takes. Derived from the tool parts like the PR/progress
  // cards — and on the STREAMING path too, deliberately: the tool waits on
  // the user mid-turn, so a card that only appeared once the turn settled
  // would hide the very thing the turn is waiting for.
  const questionCards = useMemo(
    () =>
      isUser
        ? []
        : message.parts.flatMap((part) => questionToolCardParts(part)),
    [isUser, message.parts],
  );

  // The connect card is NOT sniffed out of the assistant's prose any more. A
  // missing GitHub connection is a structured `langy_github_not_connected` domain
  // error raised from the tool stream (the control plane sees the agent reach for
  // `gh` with no token), and LangyPanel renders the card off that. Reading the
  // model's text for `[langy:connect-github]` meant trusting it to say the magic
  // words — so it could forget, paraphrase, or say them on a turn that never
  // touched GitHub.

  // The PR-flow progress card, derived from the message's TOOL PARTS — the same
  // parts the tool cards render from. `git push` IS the push; we no longer ask
  // the model to print `[langy:progress:pushed]` next to it and then regex the
  // reply. Two things get better: an errored command no longer marks its step
  // complete (a rejected push has not pushed), and the card SURVIVES A REFRESH —
  // the sentinels were stripped before the message was persisted, so it never
  // used to.
  const progressEvents = isUser
    ? []
    : githubProgressFromToolParts(message.parts);

  // Strip the hidden [langy:feedback:...] directive: when present, Langy asked
  // for feedback at a high-signal moment — surface the affordance regardless of
  // the default throttle, tailored by the sentiment it classified.
  const feedbackDirective = isUser
    ? {
        requested: false,
        sentiment: undefined,
        cleanedText: rawText,
      }
    : parseLangyFeedbackDirective(rawText);
  const text = feedbackDirective.cleanedText;

  // The live turn's tokens now arrive as `text-delta` chunks through the
  // onTurnStream subscription, so useChat's `message.parts` already carry the
  // streamed text — no separate optimistic buffer to reconcile. StreamingText
  // still gives the blur-reveal while `isStreaming`.

  const proposals = extractProposals(message);
  // The PR cards, read off the message's TOOL PARTS — not scraped from the
  // model's text. This was the LAST thing in Langy's UI steered by regexing the
  // assistant's prose: any github.com/…/pull/N URL in the reply drew a card, so
  // the model could mangle the URL, omit it, or merely MENTION a PR it never
  // opened and get a card for it. The tool part is written by the control plane
  // from `gh pr create`'s own stdout, is persisted with the message (so the card
  // survives a refresh), and skips a `gh pr create` that FAILED — a PR that did
  // not open must never render as one that did.
  const prs = isUser ? [] : githubPrsFromToolParts(message.parts);
  // Tool-call activity for the assistant turn: activity cards, each labelled by
  // what the call is DOING ("Searching traces", "Using the GitHub skill"), plus
  // the in-flight and settled domain-capability cards. Counts toward "has
  // something to render" so a turn whose only output is a running tool or a
  // settled card (no prose yet) still surfaces it.
  const showsActivity = isUser ? false : hasLangyActivity(message);
  // The plan checklist, folded from the turn's `todowrite` tool parts. When
  // present it becomes the activity spine (LangyPlanCard nests the tool cards
  // under their step); absent, the flat LangyToolActivity list renders exactly
  // as today (zero-regression path, pinned by test). On the LIVE streaming turn
  // the manager's typed snapshot (store) is preferred over raw parsing, so the
  // client honours the same caps the manager applied.
  // Completed messages do not need to subscribe to the mutable live-turn
  // snapshot. Keeping that subscription on every historical answer made one
  // plan tick reconcile the full transcript.
  const livePlan = useLangyStore((s) => (isStreaming ? s.turnPlan : null));
  const plan = isUser
    ? null
    : langyPlan(message, isStreaming ? { overrideItems: livePlan } : undefined);
  // The cards above already say which skill ran and what it does, so an opening
  // line that says it again is the same fact three times before the answer.
  // Dropped here, at the point of display — see logic/langyToolNarration.ts for
  // why this is presentation, not the prose-sniffing this file deleted.
  const displayText = isUser
    ? text
    : stripToolNarration({
        text,
        hasActivity: showsActivity || Boolean(plan),
      });
  const hasBlocks = blockSegments !== null && blockSegments.length > 0;
  const hasContent =
    displayText ||
    hasBlocks ||
    proposals.length > 0 ||
    prs.length > 0 ||
    progressEvents.length > 0 ||
    questionCards.length > 0 ||
    showsActivity ||
    Boolean(plan);
  if (
    !displayText &&
    !hasBlocks &&
    proposals.length === 0 &&
    prs.length === 0 &&
    progressEvents.length === 0 &&
    questionCards.length === 0 &&
    !showsActivity &&
    !plan &&
    !isStreaming
  )
    return null;

  if (isUser) {
    return (
      <Box alignSelf="flex-end" maxWidth="85%">
        <Box
          paddingX={3}
          paddingY={2}
          // Dedicated tokens, not `bg.muted` / `border.muted` — on the light
          // ground those two are the SAME colour, which left the bubble with no
          // edge and almost no fill. See `langy.userBubble*` in langyTheme.ts.
          background="langy.userBubbleBg"
          color="fg"
          borderWidth="1px"
          borderStyle="solid"
          borderColor="langy.userBubbleBorder"
          borderRadius="15px"
          borderBottomRightRadius="5px"
          textStyle="sm"
          lineHeight="1.5"
          whiteSpace="pre-wrap"
        >
          {text}
        </Box>
      </Box>
    );
  }

  return (
    // No avatar. Langy's mark lives on the launcher and above the empty state's
    // display line — nowhere else in the panel. A 24px logo tile repeated down
    // every answer was chrome, and at that size the mark was a smudge anyway.
    <HStack gap={2} align="flex-start" width="full">
      <VStack align="stretch" gap={2.5} flex={1} minWidth={0}>
        {/* Tool activity, all of it as CARDS: a capability's in-progress shell
            while it runs and its bespoke card once it settles, and a generic
            activity card (tool name + what it's doing + the command/path) for
            everything else. Raw JSON is developer-mode only. Single insertion
            point; all mapping lives in LangyToolActivity. */}
        {plan ? (
          <LangyCardBoundary scope="the plan">
            <LangyPlanCard plan={plan} isStreaming={isStreaming} />
          </LangyCardBoundary>
        ) : (
          <LangyCardBoundary scope="the tool activity">
            <LangyToolActivity message={message} />
          </LangyCardBoundary>
        )}
        {progressEvents.length > 0 && (
          <LangyCardBoundary scope="the progress card">
            <LangyGitHubProgressCard events={progressEvents} />
          </LangyCardBoundary>
        )}
        {prs.map((pr) => (
          <LangyCardBoundary
            key={`${pr.owner}/${pr.repo}#${pr.number}`}
            scope="this pull request card"
          >
            <LangyGitHubPrCard {...pr} />
          </LangyCardBoundary>
        ))}
        {proposals.map(({ id, proposal }) => (
          <LangyCardBoundary key={id} scope="this proposal">
            <ProposalCard
              proposal={proposal}
              appliedOutcome={appliedOutcomes[id]}
              isDiscarded={discardedProposals.has(id)}
              isApplying={applyingProposals.has(id)}
              onApply={() => void onApply(id, proposal)}
              onDiscard={() => onDiscard(id)}
            />
          </LangyCardBoundary>
        ))}
        {/* Work precedes its conclusion. Rendering prose first made settled
            turns appear to run backwards: answer, then the commands that found
            it. The prompt suppresses process narration, so this is the useful
            interpretation that follows the evidence/cards above. */}
        {/* The answer wears the theme's answer tokens (langyTheme.ts): half a
            step smaller than the user's `sm` bubble and a step dimmer than
            `fg`, so a glance separates "what I said" from "what it said". */}
        {blockSegments ? (
          <AnswerWithCards
            segments={blockSegments}
            hasActivity={showsActivity || Boolean(plan)}
            projectSlug={project?.slug ?? null}
            choicesTimeline={choicesTimeline}
            onChoiceSelect={onChoiceSelect}
            onVerifyDerivedCard={onVerifyDerivedCard}
          />
        ) : (
          displayText &&
          (isStreaming ? (
            // The live turn: prose streams as ever, and any forming
            // ```langy-card fence previews through the SAME validation the
            // relay stamps with at settle (ADR-060 §7). Fence-less streams
            // take the plain path inside, unchanged.
            <StreamingAnswerWithCards
              text={displayText}
              projectSlug={project?.slug ?? null}
            />
          ) : (
            <Box
              css={{
                "& > div > :first-child": { marginTop: 0 },
                "& > div > :last-child": { marginBottom: 0 },
                "& table": { display: "block", overflowX: "auto" },
              }}
            >
              <Markdown
                fontSize="langyAnswer"
                linkVariant="langy"
                color="langy.answerFg"
              >
                {displayText}
              </Markdown>
            </Box>
          ))
        )}
        {/* The question the agent is waiting on — the interactive choices
            card, after the prose so the ask reads as the turn's closing line.
            Lock state derives from the same recorded timeline as a stamped
            choices block, so an answered question stays marked forever and a
            moved-on conversation closes it. */}
        {questionCards.map((part) => (
          <LangyCardBoundary key={part.blockId} scope="this question">
            <LangyDerivedCardView
              card={part.card}
              projectSlug={project?.slug ?? null}
              choicesLockState={deriveLangyChoicesLockState({
                blockId: part.blockId,
                timeline: choicesTimeline ?? [],
              })}
              onChoiceSelect={onChoiceSelect}
            />
          </LangyCardBoundary>
        ))}
        {/* WHEN to ask is the backend's call (langy.messages `shouldAskFeedback` —
            conversation depth + a per-user quiet period), or the agent's own
            [langy:feedback] directive at a high-signal moment, or the user
            typing /feedback. `showFeedback` is only the position + settled
            gate; the substance floor still stops the default path from rating
            a bare one-word ack. `isFeedbackPinned` (a pin) keeps a shown card
            mounted across the refetch that follows the shown-mark, and powers
            /feedback. Never renders mid-stream. */}
        {showFeedback &&
        !isStreaming &&
        displayText &&
        (isFeedbackPinned ||
          feedbackDirective.requested ||
          (shouldAskFeedback && isSubstantiveLangyAnswer(displayText))) ? (
          <LangyFeedback
            conversationId={conversationId ?? undefined}
            messageId={message.id}
            sentiment={feedbackDirective.sentiment}
            origin={
              feedbackDirective.requested
                ? "directive"
                : shouldAskFeedback
                  ? "asked"
                  : "requested"
            }
          />
        ) : null}
      </VStack>
    </HStack>
  );
}

export const MessageContent = memo(MessageContentImpl);
MessageContent.displayName = "MessageContent";

/** Everything a rendered answer segment can bind to, threaded once. */
interface AnswerBlockContext {
  hasActivity: boolean;
  firstTextIndex: number;
  projectSlug: string | null;
  choicesTimeline?: LangyChoicesTimelineEntry[];
  onChoiceSelect?: (a: {
    selection: LangyChoiceSelection;
    card: LangyDerivedChoicesCard;
  }) => void;
  onVerifyDerivedCard?: (a: { card: LangyDerivedCard }) => void;
}

/**
 * The settled answer, rendered in the reply's own order (ADR-060 §1): one
 * flat dispatch per segment type — prose, derived card, failed disclosure —
 * mirroring the registry idiom the capability cards use. Every card sits in
 * its own error boundary so one bad payload costs one card, never the
 * answer.
 */
function AnswerWithCards({
  segments,
  ...context
}: { segments: LangyAnswerSegment[] } & Omit<
  AnswerBlockContext,
  "firstTextIndex"
>) {
  const firstTextIndex = segments.findIndex(
    (segment) => segment.type === "text",
  );
  return (
    <VStack align="stretch" gap={2.5}>
      {segments.map((segment, index) => (
        <AnswerSegment
          key={segmentKey(segment, index)}
          segment={segment}
          index={index}
          context={{ ...context, firstTextIndex }}
        />
      ))}
    </VStack>
  );
}

/** Stable-enough keys: blocks by identity, prose by position. */
function segmentKey(segment: LangyAnswerSegment, index: number): string {
  return segment.type === "text"
    ? `text-${index}`
    : `${segment.type}-${segment.part.blockId}-${index}`;
}

/** One segment, one renderer — a flat exhaustive switch, nothing nested. */
function AnswerSegment({
  segment,
  index,
  context,
}: {
  segment: LangyAnswerSegment;
  index: number;
  context: AnswerBlockContext;
}) {
  switch (segment.type) {
    case "text":
      return (
        <ProseSegment
          text={segment.text}
          isFirst={index === context.firstTextIndex}
          hasActivity={context.hasActivity}
        />
      );
    case "card":
      return (
        <LangyCardBoundary scope="this derived card">
          <LangyDerivedCardView
            card={segment.part.card}
            hints={segment.part.hints}
            projectSlug={context.projectSlug}
            choicesLockState={
              segment.part.card.kind === "choices"
                ? deriveLangyChoicesLockState({
                    blockId: segment.part.blockId,
                    timeline: context.choicesTimeline ?? [],
                  })
                : undefined
            }
            onChoiceSelect={context.onChoiceSelect}
            onVerify={context.onVerifyDerivedCard}
          />
        </LangyCardBoundary>
      );
    case "failed":
      return (
        <LangyCardBoundary scope="this card">
          <LangyFailedCard part={segment.part} />
        </LangyCardBoundary>
      );
  }
}

/**
 * A prose run between blocks — the same presentation transforms the joined
 * path applies: the feedback directive never renders, and the opening
 * narration is stripped from the first prose segment only.
 */
function ProseSegment({
  text,
  isFirst,
  hasActivity,
}: {
  text: string;
  isFirst: boolean;
  hasActivity: boolean;
}) {
  const cleaned = parseLangyFeedbackDirective(text).cleanedText;
  const display = isFirst
    ? stripToolNarration({ text: cleaned, hasActivity })
    : cleaned;
  if (!display) return null;
  return (
    <Box
      css={{
        "& > div > :first-child": { marginTop: 0 },
        "& > div > :last-child": { marginBottom: 0 },
        "& table": { display: "block", overflowX: "auto" },
      }}
    >
      <Markdown fontSize="langyAnswer" linkVariant="langy" color="langy.answerFg">
        {display}
      </Markdown>
    </Box>
  );
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
  appliedOutcome?: { href?: string; label?: string; onOpen?: () => void };
  isDiscarded: boolean;
  isApplying: boolean;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const router = useRouter();
  const isApplied = !!appliedOutcome;
  const destructive = !!proposal.destructive;
  const openHref = appliedOutcome?.href;
  const onOpen = appliedOutcome?.onOpen;
  const openLabel = appliedOutcome?.label ?? "Open";
  const hasOpen = !!onOpen || !!openHref;

  // Resolve overline copy + colour up front so the JSX below doesn't read
  // like a five-deep nested ternary. Each branch states one thing.
  const overlineLabel = (() => {
    if (isApplied) return destructive ? "Done" : "Applied";
    if (isDiscarded) return "Discarded";
    if (isApplying) return destructive ? "Deleting…" : "Applying…";
    return destructive ? "Wants to delete" : "Proposal";
  })();

  const overlineColor = (() => {
    if (destructive && !isApplied) return "var(--chakra-colors-red-fg)";
    if (isApplied && !destructive) return "var(--chakra-colors-green-fg)";
    if (isDiscarded) return "var(--chakra-colors-fg-muted)";
    return "var(--chakra-colors-purple-fg)";
  })();

  const triggerOpen = () => {
    if (onOpen) {
      onOpen();
      return;
    }
    if (!openHref) return;
    // A trace link (or any in-app destination) is an SPA route: push it through
    // the app router so opening the trace keeps the Langy panel and the rest of
    // the app mounted, instead of a full-page reload that tears the session
    // down. External links (a GitHub PR, say) still get a real navigation.
    if (isInternalHref(openHref)) {
      void router.push(openHref);
    } else {
      window.location.href = openHref;
    }
  };

  return (
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding={3}
      background="bg.subtle"
      opacity={isDiscarded ? 0.65 : 1}
      cursor={hasOpen ? "pointer" : "default"}
      // When the card behaves as a button (an applied proposal that opens
      // something on click) it needs button semantics so keyboard / screen-
      // reader users can activate it. Without this, only mouse users could
      // reach the affordance — the inner Open button is the keyboard
      // fallback but the whole-card click target is invisible to a11y.
      {...(hasOpen
        ? {
            role: "button",
            tabIndex: 0,
            "aria-label": `${openLabel}: ${proposal.summary}`,
            onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              const target = e.target as HTMLElement;
              if (target.closest("a, button")) return;
              e.preventDefault();
              triggerOpen();
            },
          }
        : {})}
      onClick={(e) => {
        if (!hasOpen) return;
        const target = e.target as HTMLElement;
        if (target.closest("a, button")) return;
        triggerOpen();
      }}
      transition="border-color 150ms ease, box-shadow 150ms ease"
      _hover={
        hasOpen ? { borderColor: "green.fg", boxShadow: "sm" } : undefined
      }
    >
      <HStack
        gap={1.5}
        marginBottom={2}
        textStyle="2xs"
        fontWeight="600"
        letterSpacing="0.08em"
        textTransform="uppercase"
        color={overlineColor}
      >
        {isApplied && !destructive ? (
          <Check size={11} />
        ) : (
          <Sparkles size={11} />
        )}
        <Text>{overlineLabel}</Text>
      </HStack>
      <Text textStyle="sm" fontWeight="600" color="fg" marginBottom={0.5}>
        {proposal.summary}
      </Text>
      {proposal.rationale && (
        <Text
          textStyle="xs"
          color="fg.muted"
          lineHeight="1.45"
          marginBottom={3}
        >
          {proposal.rationale}
        </Text>
      )}
      {!isApplied && !isDiscarded && (
        <HStack gap={1.5} paddingTop={proposal.rationale ? 0 : 2.5}>
          <chakra.button
            type="button"
            flex={1}
            paddingX={3}
            paddingY={2}
            borderRadius="md"
            borderWidth={0}
            background={
              destructive ? "var(--chakra-colors-red-solid)" : "transparent"
            }
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
            {!destructive && (
              <LangyMeshLayer borderRadius="md" active={isApplying} />
            )}
            <Box
              position="relative"
              zIndex={1}
              display="flex"
              alignItems="center"
              gap={1.5}
            >
              <Check size={12} />
              {isApplying
                ? destructive
                  ? "Deleting…"
                  : "Applying…"
                : destructive
                  ? "Delete"
                  : "Apply"}
            </Box>
          </chakra.button>
          <Button
            size="xs"
            variant="outline"
            onClick={onDiscard}
            disabled={isApplying}
          >
            {destructive ? "Cancel" : "Discard"}
          </Button>
        </HStack>
      )}
      {isApplied && hasOpen && (
        <HStack paddingTop={2.5}>
          {onOpen ? (
            <Button
              size="xs"
              variant="outline"
              colorPalette="green"
              onClick={triggerOpen}
            >
              {openLabel}
              <ArrowRight size={12} />
            </Button>
          ) : openHref ? (
            <Button size="xs" variant="outline" colorPalette="green" asChild>
              <a
                href={openHref}
                onClick={(e) => {
                  // Keep the real anchor so cmd/ctrl/shift-click and middle-
                  // click still open a new tab, and right-click still offers
                  // "open in new tab". Intercept ONLY a plain left click on an
                  // in-app link, and SPA-navigate it instead of full-reloading.
                  if (!isInternalHref(openHref)) return;
                  if (
                    e.defaultPrevented ||
                    e.button !== 0 ||
                    e.metaKey ||
                    e.ctrlKey ||
                    e.shiftKey ||
                    e.altKey
                  ) {
                    return;
                  }
                  e.preventDefault();
                  void router.push(openHref);
                }}
              >
                {openLabel}
                <ArrowRight size={12} />
              </a>
            </Button>
          ) : null}
        </HStack>
      )}
    </Box>
  );
}

function extractProposals(
  message: UIMessage,
): Array<{ id: string; proposal: LangyProposal }> {
  const result: Array<{ id: string; proposal: LangyProposal }> = [];
  for (const part of message.parts) {
    if (!part.type?.startsWith("tool-")) continue;
    const output = (part as { output?: unknown }).output;
    if (!isLangyProposal(output)) continue;
    const id =
      (part as { toolCallId?: string }).toolCallId ??
      `${message.id}:${result.length}`;
    result.push({ id, proposal: output });
  }
  return result;
}

function isLangyProposal(value: unknown): value is LangyProposal {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.langyProposal === true &&
    typeof v.kind === "string" &&
    typeof v.summary === "string"
  );
}
