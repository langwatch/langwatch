import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { Markdown } from "@langwatch/browser-host/markdown";
import { useLangyStore } from "@langwatch/langy-browser-kit";
import type {
  LangyChoiceSelection,
  LangyChoicesLockState,
  LangyChoicesTimelineEntry,
  LangyDerivedCard,
  LangyDerivedChoicesCard,
} from "@langwatch/langy-contract";
import {
  deriveLangyChoicesLockState,
  githubProgressFromToolParts,
} from "@langwatch/langy-contract";
import {
  type GuidedPullRequest,
  guidedKickoffPartOf,
  guidedPathCompletedIn,
} from "@langwatch/onboarding-browser-kit";
import type { UIMessage } from "ai";
import { memo, useMemo } from "react";

import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project.ts";
import {
  hasLangyBlockParts,
  type LangyAnswerSegment,
  langyAnswerSegments,
  langyAnswerSegmentsFromText,
} from "../../../../model/langy-answer-segments.ts";
import {
  codeAccessCallId,
  codeAccessOffersDescribe,
} from "../../../../model/langy-code-access-tool.ts";
import {
  isSubstantiveLangyAnswer,
  parseLangyFeedbackDirective,
} from "../../../../model/langy-feedback-directive.ts";
import {
  type LangyQuestionCardData,
  langyAnsweredOptionIds,
  toolCallIdOfQuestionBlock,
} from "../../../../model/langy-local-waits.ts";
import { langyPlan } from "../../../../model/langy-plan.ts";
import {
  linkPullRequestReferences,
  pullRequestLinksFromToolParts,
} from "../../../../model/langy-pull-request-links.ts";
import { questionToolCardParts } from "../../../../model/langy-question-tool.ts";
import {
  foldReasoningTitles,
  stripReasoningTitles,
} from "../../../../model/langy-reasoning-titles.ts";
import { sayToolText } from "../../../../model/langy-say-tool.ts";
import { offerNotificationsCallId } from "../../../../model/langy-notifications.ts";
import { secretSnippetCalls } from "../../../../model/langy-secret-snippet-tool.ts";
import { stripToolNarration } from "../../../../model/langy-tool-narration.ts";
import {
  langyRunText,
  type LangyTranscriptRun,
  langyTranscriptRuns,
} from "../../../../model/langy-transcript.ts";
import { githubPrsFromToolParts } from "../../../../model/shared/langy/github-pr-card.ts";
import { LangyFailedCard } from "../../../../ui/elements/derived-cards/langy-failed-card.tsx";
import { LangyGitHubProgressCard } from "../../../../ui/elements/github/langy-github-progress-card.tsx";
import { LangyCardBoundary } from "../../../../ui/elements/langy-card-boundary.tsx";
import { LangyCodeAccessCard } from "../../../../ui/sections/derived-cards/langy-code-access-card.tsx";
import { LangyDerivedCardView } from "../../../../ui/sections/derived-cards/langy-derived-card-view.tsx";
import { LangySecretSnippetCard } from "../../../../ui/sections/derived-cards/langy-secret-snippet-card.tsx";
import { LangyNotificationsOfferCard } from "./langy-notifications-offer-card.tsx";
import { LangyGitHubPrCard } from "../elements/github/langy-git-hub-pr-card.tsx";
import { LangyGuidedPrCard } from "../elements/github/langy-guided-pr-card.tsx";
import { GuidedTourCard } from "./derived-cards/guided-tour-card.tsx";
import { StreamingAnswerWithCards } from "./derived-cards/streaming-answer-with-cards.tsx";
import { LangyFeedback } from "./langy-feedback.tsx";
import { LangyPlanCard } from "./langy-plan-card.tsx";
import { type LangyProposal, ProposalCard } from "./langy-proposal-card.tsx";
import { hasLangyActivity, LangyActivityParts } from "./langy-tool-activity.tsx";

/** Why the feedback prompt is on screen, as the origin it reports. */
function feedbackOrigin({
  requested,
  shouldAskFeedback,
}: {
  requested: boolean;
  shouldAskFeedback: boolean;
}) {
  if (requested) return "directive";
  return shouldAskFeedback ? "asked" : "requested";
}

/** What one transcript message is drawn with. */
type MessageContentProps = {
  message: UIMessage;
  organizationId?: string | null;
  appliedOutcomes: Record<string, { href?: string; label?: string; onOpen?: () => void }>;
  discardedProposals: Set<string>;
  applyingProposals: Set<string>;
  onApply: (proposalId: string, proposal: LangyProposal) => Promise<void>;
  onDiscard: (proposalId: string) => void;
  /** True for the in-flight assistant turn — streams tokens with blur reveal. */
  isStreaming?: boolean;
  /**
   * This browser stopped the turn behind this reply (ADR-078). An empty
   * settled reply then reads "Interrupted" instead of "No content" — the
   * emptiness was the user's own doing, and the copy should say so.
   */
  interrupted?: boolean;
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
  onChoiceSelect?: (a: { selection: LangyChoiceSelection; card: LangyDerivedChoicesCard }) => void;
  /** Bind a derived card's verify hint. Absent = chip hidden. */
  onVerifyDerivedCard?: (a: { card: LangyDerivedCard }) => void;
  /**
   * The question waits of this conversation, keyed by the tool call that asked (ADR-129). A
   * mid-turn answer writes no selection into the transcript, so the lock state must read the
   * wait, not the timeline, to know a question already settled.
   */
  questionWaits?: ReadonlyMap<string, LangyQuestionCardData>;
  /**
   * Stop whatever is running and ask Langy the code access question again —
   * what the code access card's Change and Ask again controls do. Absent =
   * the card renders read-only.
   */
  onAskCodeAccessAgain?: () => void;
  /**
   * The `code_access` call the whole conversation is asking on right now
   * (`latestCodeAccessCallId`). A card hanging on an older call renders
   * closed. Absent = this message is read on its own, so its card is live.
   */
  liveCodeAccessCallId?: string | null;
  /**
   * Leave the PR-flow progress card out. A guided conversation tells the pull request as a
   * sentence with a link and, at the end of the path, as one PR card; the step-by-step receipt
   * would say the same thing a third time.
   */
  hideGithubProgress?: boolean;
  /** The pull request a guided path opened (or the branch alone), drawn after the closing line. */
  guidedPullRequest?: GuidedPullRequest | null;
};

function MessageContentImpl(props: MessageContentProps) {
  const { message } = props;
  // A message from the developer, or a notice the platform wrote into the
  // transcript (ADR-129): plain text, so none of the assistant reading applies.
  if (message.role === "user" || message.role === "system")
    return <PlainMessage message={message} organizationId={props.organizationId ?? null} />;
  return <AssistantMessage {...props} />;
}

/** The text parts of a message, one paragraph apart; `reasoning` never joins the answer. */
function messageText(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .filter((text) => text.length > 0)
    .join("\n\n");
}

/**
 * The developer's own words, as a bubble on the right; or a notice — something that HAPPENED to
 * the conversation — as a quiet centred line: no bubble, which would claim the reader sent it.
 */
function PlainMessage({
  message,
  organizationId,
}: {
  message: UIMessage;
  organizationId: string | null;
}) {
  // The guided onboarding kickoff is a user message on the wire and the tour card on screen:
  // the brief it carries is for the model, never a bubble.
  const kickoff = message.role === "user" ? guidedKickoffPartOf(message.parts) : null;
  if (kickoff) return <GuidedTourCard kickoff={kickoff} organizationId={organizationId} />;
  const text = messageText(message);
  if (!text && extractProposals(message).length === 0) return null;
  if (message.role === "system") {
    return (
      <Text
        data-testid="langy-transcript-notice"
        alignSelf="center"
        maxWidth="85%"
        textAlign="center"
        textStyle="xs"
        color="fg.muted"
        whiteSpace="pre-wrap"
      >
        {text}
      </Text>
    );
  }
  return (
    <Box alignSelf="flex-end" maxWidth="85%">
      <Box
        data-testid="langy-user-message"
        paddingX={3}
        paddingY={2}
        // Dedicated tokens: on the light ground `bg.muted` and `border.muted` are
        // the SAME colour. See `langy.userBubble*` in langyTheme.ts.
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

/** The last run carrying the reply: a said line, or an answer with prose in it. */
function lastAnswerRun(runs: LangyTranscriptRun[]): number {
  return runs.findLastIndex(
    (run) =>
      run.kind === "say" || (run.kind === "answer" && langyRunText(run.parts).trim().length > 0),
  );
}

/**
 * Everything an assistant reply is read into, from its own parts: the runs in their order, the
 * cards its tool calls raised, the plan, and the prose left once the feedback directive, the
 * thinking headlines and the narration the cards already say are taken out.
 */
function useAnswerReading({ message, isStreaming }: { message: UIMessage; isStreaming: boolean }) {
  const parts = message.parts;
  const runs = useMemo(() => langyTranscriptRuns(parts), [parts]);
  const questionCards = useMemo(
    () => parts.flatMap((part) => questionToolCardParts(part)),
    [parts],
  );
  const codeAccessCall = useMemo(() => codeAccessCallId(parts), [parts]);
  const codeAccessDescribe = useMemo(() => codeAccessOffersDescribe(parts), [parts]);
  const secretSnippets = useMemo(() => secretSnippetCalls(parts), [parts]);
  // The notifications offer (`offer_notifications`). The answer lives on the account, so the
  // card reads it there and a reload shows what was chosen.
  const offersNotifications = useMemo(() => offerNotificationsCallId(parts) !== null, [parts]);
  const pullRequestLinks = useMemo(() => pullRequestLinksFromToolParts(parts), [parts]);
  // The live turn prefers the manager's typed plan snapshot; settled ones do not subscribe.
  const livePlan = useLangyStore((s) => (isStreaming ? s.turnPlan : null));
  const plan = langyPlan(message, isStreaming ? { overrideItems: livePlan } : undefined);
  // The hidden [langy:feedback:...] directive: Langy asked for feedback at a high-signal moment.
  const feedbackDirective = parseLangyFeedbackDirective(messageText(message));
  const showsActivity = hasLangyActivity(message);
  const hasActivity = showsActivity || Boolean(plan);
  // Thinking headlines fold into the receipt on a settled turn, never loose paragraphs above it.
  const reasoningFold = isStreaming
    ? { titles: [], text: feedbackDirective.cleanedText }
    : foldReasoningTitles({ parts, text: feedbackDirective.cleanedText, hasActivity });
  return {
    runs,
    questionCards,
    codeAccessCall,
    codeAccessDescribe,
    secretSnippets,
    offersNotifications,
    pullRequestLinks,
    plan,
    feedbackDirective,
    showsActivity,
    hasActivity,
    reasoningTitles: reasoningFold.titles,
    // The cards already say which skill ran; an opening line saying it again is dropped here.
    displayText: stripToolNarration({ text: reasoningFold.text, hasActivity }),
    // Read off the tool parts, never scraped from the model's prose; persisted with the message.
    progressEvents: githubProgressFromToolParts(parts),
    prs: githubPrsFromToolParts(parts),
    proposals: extractProposals(message),
    hasBlocks: hasLangyBlockParts(parts),
  };
}

type AnswerReading = ReturnType<typeof useAnswerReading>;

/** Anything at all to draw: prose, a block, a card, the activity, or the plan. */
function answerHasContent(reading: AnswerReading): boolean {
  const cardCount =
    reading.proposals.length +
    reading.prs.length +
    reading.progressEvents.length +
    reading.questionCards.length +
    reading.secretSnippets.length;
  return Boolean(
    reading.displayText ||
    reading.hasBlocks ||
    cardCount > 0 ||
    reading.offersNotifications ||
    reading.showsActivity ||
    reading.plan,
  );
}

/**
 * WHEN to ask is the backend's `shouldAskFeedback`, the agent's own directive, or /feedback;
 * `showFeedback` is only the position + settled gate, and never mid-stream.
 */
function showsFeedbackPrompt({
  props,
  reading,
}: {
  props: MessageContentProps;
  reading: AnswerReading;
}): boolean {
  const askedFor =
    props.isFeedbackPinned ||
    reading.feedbackDirective.requested ||
    (props.shouldAskFeedback && isSubstantiveLangyAnswer(reading.displayText));
  return Boolean(props.showFeedback && !props.isStreaming && reading.displayText && askedFor);
}

/**
 * A settled reply with nothing visible to say — the model spent the turn reasoning, or the user
 * stopped it first. While streaming there is no box at all: the working lines own the live edge.
 */
function EmptyAnswer({ isStreaming, interrupted }: { isStreaming: boolean; interrupted: boolean }) {
  if (isStreaming) return null;
  return <MutedAnswerLine>{interrupted ? "Interrupted" : "No content"}</MutedAnswerLine>;
}

function MutedAnswerLine({ children }: { children: string }) {
  return (
    <Text
      fontSize="langyAnswer"
      lineHeight="1.5"
      paddingX="2px"
      fontStyle="italic"
      color="fg.muted"
    >
      {children}
    </Text>
  );
}

/**
 * An assistant reply, as the sequence it was: the plan (once settled — while the turn runs the
 * panel holds it above the composer), the runs in their own order, then the cards the turn raised.
 * No avatar: Langy's mark lives on the launcher and the empty state, nowhere else.
 */
function AssistantMessage(props: MessageContentProps) {
  const { message, isStreaming = false, interrupted = false, conversationId } = props;
  const { project } = useOrganizationTeamProject();
  const reading = useAnswerReading({ message, isStreaming });
  if (!answerHasContent(reading)) {
    return <EmptyAnswer isStreaming={isStreaming} interrupted={interrupted} />;
  }
  const view: RunView = {
    isStreaming,
    // A RECORDED message is left alone: the relay already ruled on its fences.
    isRecorded: isRecordedMessage(message),
    hasActivity: reading.hasActivity,
    projectSlug: project?.slug ?? null,
    pullRequestLinks: reading.pullRequestLinks,
    choicesTimeline: props.choicesTimeline,
    onChoiceSelect: props.onChoiceSelect,
    onVerifyDerivedCard: props.onVerifyDerivedCard,
    reasoningTitles: reading.reasoningTitles,
    lastActivityRunIndex: reading.runs.findLastIndex((run) => run.kind === "activity"),
    lastAnswerRunIndex: lastAnswerRun(reading.runs),
  };
  const settledPlan = isStreaming ? null : reading.plan;
  return (
    <HStack data-testid="langy-assistant-message" gap={2} align="flex-start" width="full">
      <VStack align="stretch" gap={2.5} flex={1} minWidth={0}>
        {settledPlan ? (
          <LangyCardBoundary scope="the plan">
            <LangyPlanCard
              plan={settledPlan}
              reasoningTitles={reading.reasoningTitles}
              isStreaming={false}
            />
          </LangyCardBoundary>
        ) : null}
        {reading.runs.map((run, index) => renderRun({ run, index, view }))}
        <AnswerCards
          props={props}
          reading={reading}
          projectId={project?.id}
          projectSlug={view.projectSlug}
        />
        {/* The reply the user cut short says so, whatever it managed to say first. */}
        {interrupted && !isStreaming ? <MutedAnswerLine>Interrupted</MutedAnswerLine> : null}
        {showsFeedbackPrompt({ props, reading }) ? (
          <LangyFeedback
            conversationId={conversationId ?? undefined}
            messageId={message.id}
            sentiment={reading.feedbackDirective.sentiment}
            origin={feedbackOrigin({
              requested: reading.feedbackDirective.requested,
              shouldAskFeedback: props.shouldAskFeedback ?? false,
            })}
          />
        ) : null}
      </VStack>
    </HStack>
  );
}

/** A message the relay recorded off the durable fold, rather than one this browser streamed. */
function isRecordedMessage(message: UIMessage): boolean {
  const metadata = message.metadata;
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    "recorded" in metadata &&
    metadata.recorded === true
  );
}

/**
 * The cards the turn raised, after its prose: progress, pull requests, proposals, the question it
 * waits on (locked by its wait, else by the recorded timeline), code access and secrets.
 */
function AnswerCards({
  props,
  reading,
  projectId,
  projectSlug,
}: {
  props: MessageContentProps;
  reading: AnswerReading;
  projectId: string | undefined;
  projectSlug: string | null;
}) {
  const organizationId = props.organizationId ?? null;
  return (
    <>
      {reading.progressEvents.length > 0 && !props.hideGithubProgress ? (
        <LangyCardBoundary scope="the progress card">
          <LangyGitHubProgressCard
            events={reading.progressEvents}
            live={props.isStreaming ?? false}
          />
        </LangyCardBoundary>
      ) : null}
      {reading.prs.map((pr) => (
        <LangyCardBoundary
          key={`${pr.owner}/${pr.repo}#${pr.number}`}
          scope="this pull request card"
        >
          <LangyGitHubPrCard {...pr} />
        </LangyCardBoundary>
      ))}
      {props.guidedPullRequest && guidedPathCompletedIn(props.message.parts) ? (
        <LangyCardBoundary scope="the pull request card">
          <LangyGuidedPrCard {...props.guidedPullRequest} />
        </LangyCardBoundary>
      ) : null}
      {reading.proposals.map(({ id, proposal }) => (
        <LangyCardBoundary key={id} scope="this proposal">
          <ProposalCard
            proposal={proposal}
            appliedOutcome={props.appliedOutcomes[id]}
            isDiscarded={props.discardedProposals.has(id)}
            isApplying={props.applyingProposals.has(id)}
            onApply={() => void props.onApply(id, proposal)}
            onDiscard={() => props.onDiscard(id)}
          />
        </LangyCardBoundary>
      ))}
      {reading.questionCards.map((part) => (
        <LangyCardBoundary key={part.blockId} scope="this question">
          <LangyDerivedCardView
            card={part.card}
            projectSlug={projectSlug}
            choicesLockState={questionLockState({ part, props })}
            onChoiceSelect={props.onChoiceSelect}
          />
        </LangyCardBoundary>
      ))}
      <CodeAccessCardSlot
        props={props}
        callId={reading.codeAccessCall}
        offerDescribe={reading.codeAccessDescribe}
        projectId={projectId}
      />
      {reading.secretSnippets.map((call) => (
        <LangyCardBoundary key={call.callId} scope="the secret snippet card">
          <LangySecretSnippetCard organizationId={organizationId} call={call} />
        </LangyCardBoundary>
      ))}
      {reading.offersNotifications ? (
        <LangyCardBoundary scope="the notifications card">
          <LangyNotificationsOfferCard />
        </LangyCardBoundary>
      ) : null}
    </>
  );
}

/** A question's lock state: what its wait settled, else what the recorded timeline says. */
function questionLockState({
  part,
  props,
}: {
  part: { blockId: string; card: LangyDerivedCard };
  props: MessageContentProps;
}): LangyChoicesLockState {
  return (
    questionWaitLockState({ blockId: part.blockId, card: part.card, waits: props.questionWaits }) ??
    deriveLangyChoicesLockState({ blockId: part.blockId, timeline: props.choicesTimeline ?? [] })
  );
}

/**
 * How Langy reaches this person's code (ADR-129): asked once per conversation by the tool, the
 * card reading its own state; one hanging on an older call than the live one renders closed.
 */
function CodeAccessCardSlot({
  props,
  callId,
  offerDescribe,
  projectId,
}: {
  props: MessageContentProps;
  callId: string | null;
  offerDescribe: boolean;
  projectId: string | undefined;
}) {
  const { conversationId, liveCodeAccessCallId, onChoiceSelect, onAskCodeAccessAgain } = props;
  if (!callId || !conversationId || !projectId) return null;
  return (
    <LangyCardBoundary scope="the code access card">
      <LangyCodeAccessCard
        projectId={projectId}
        conversationId={conversationId}
        callId={callId}
        organizationId={props.organizationId ?? null}
        superseded={liveCodeAccessCallId != null && liveCodeAccessCallId !== callId}
        offerDescribe={offerDescribe}
        {...(onChoiceSelect ? { onChoiceSelect } : {})}
        {...(onAskCodeAccessAgain ? { onAskAgain: onAskCodeAccessAgain } : {})}
      />
    </LangyCardBoundary>
  );
}

export const MessageContent = memo(MessageContentImpl);
MessageContent.displayName = "MessageContent";

/** Everything a rendered answer segment can bind to, threaded once. */
interface AnswerBlockContext {
  hasActivity: boolean;
  firstTextIndex: number;
  projectSlug: string | null;
  /** Pull-request number → URL, from this message's own tool calls. */
  pullRequestLinks: Map<number, string>;
  choicesTimeline?: LangyChoicesTimelineEntry[];
  onChoiceSelect?: (a: { selection: LangyChoiceSelection; card: LangyDerivedChoicesCard }) => void;
  onVerifyDerivedCard?: (a: { card: LangyDerivedCard }) => void;
}

/**
 * One run of the reply: the prose between two calls, with any card blocks stamped into
 * it.
 */
function AnswerRun({
  parts,
  isStreaming,
  isRecorded,
  ...context
}: {
  parts: readonly unknown[];
  isStreaming: boolean;
  /** A message the relay recorded: its fences were already ruled on. */
  isRecorded: boolean;
} & Omit<AnswerBlockContext, "firstTextIndex">) {
  const text = langyRunText(parts);
  // Blocks, when this run has any: stamped parts on a recorded message, or the
  // fences of a copy this browser streamed and nothing has stamped.
  const segments = useMemo(() => {
    if (isStreaming) return null;
    if (hasLangyBlockParts(parts)) return langyAnswerSegments(parts);
    return isRecorded ? null : langyAnswerSegmentsFromText(text);
  }, [isStreaming, isRecorded, parts, text]);
  const cleaned = parseLangyFeedbackDirective(text).cleanedText;
  const display = linkPullRequestReferences({
    text: stripToolNarration({
      text: isStreaming
        ? cleaned
        : stripReasoningTitles({
            text: cleaned,
            hasActivity: context.hasActivity,
          }),
      hasActivity: context.hasActivity,
    }),
    links: context.pullRequestLinks,
  });

  if (segments) {
    return segments.length > 0 ? <AnswerWithCards segments={segments} {...context} /> : null;
  }
  if (!display) return null;
  // The live turn: prose streams as ever, and any forming ```langy-card fence
  // previews through the SAME validation the relay stamps with at settle
  // (ADR-060 §7). Fence-less streams take the plain path inside, unchanged.
  if (isStreaming) {
    return (
      <Box paddingX="2px">
        <StreamingAnswerWithCards text={display} projectSlug={context.projectSlug} />
      </Box>
    );
  }
  return (
    <Box
      // The cards around it have a border plus their own inner padding, so a
      // flush-left paragraph sat a hair OUTSIDE their text edge. Two pixels
      // tucks the prose onto the same optical column.
      paddingX="2px"
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

/**
 * The settled answer, rendered in the reply's own order (ADR-060 §1): one flat dispatch
 * per segment type — prose, derived card, failed disclosure — mirroring the registry
 * idiom the capability cards use.
 */
function AnswerWithCards({
  segments,
  ...context
}: { segments: LangyAnswerSegment[] } & Omit<AnswerBlockContext, "firstTextIndex">) {
  const firstTextIndex = segments.findIndex((segment) => segment.type === "text");
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
          pullRequestLinks={context.pullRequestLinks}
        />
      );
    case "card": {
      const card = segment.part.card;
      return (
        <LangyCardBoundary scope="this derived card">
          <LangyDerivedCardView
            card={card}
            hints={segment.part.hints}
            projectSlug={context.projectSlug}
            choicesLockState={
              card.kind === "choices"
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
    }
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
  pullRequestLinks,
}: {
  text: string;
  isFirst: boolean;
  hasActivity: boolean;
  pullRequestLinks: Map<number, string>;
}) {
  const cleaned = parseLangyFeedbackDirective(text).cleanedText;
  const display = linkPullRequestReferences({
    text: isFirst
      ? stripToolNarration({
          // The reply's leading reasoning headlines fold into the receipt (the
          // message-level fold already collected them from the full text); the
          // first prose segment starts with the same leading edge, so it peels
          // the same headlines before rendering.
          text: stripReasoningTitles({ text: cleaned, hasActivity }),
          hasActivity,
        })
      : cleaned,
    links: pullRequestLinks,
  });
  if (!display) return null;
  return (
    <Box
      // Same 2px optical alignment as the joined path: prose lines up with
      // the inner text of the bordered cards above it.
      paddingX="2px"
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

function extractProposals(message: UIMessage): { id: string; proposal: LangyProposal }[] {
  const result: { id: string; proposal: LangyProposal }[] = [];
  for (const part of message.parts) {
    if (!part.type?.startsWith("tool-")) continue;
    const output = (part as { output?: unknown }).output;
    if (!isLangyProposal(output)) continue;
    const id = (part as { toolCallId?: string }).toolCallId ?? `${message.id}:${result.length}`;
    result.push({ id, proposal: output });
  }
  return result;
}

function isLangyProposal(value: unknown): value is LangyProposal {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.langyProposal === true && typeof v.kind === "string" && typeof v.summary === "string";
}

/**
 * What a settled question wait says about one choices card, or null when the wait knows nothing
 * and the timeline should answer instead. A pending wait leaves the card open; ended locks it.
 */
function questionWaitLockState({
  blockId,
  card,
  waits,
}: {
  blockId: string;
  card: LangyDerivedCard;
  waits: ReadonlyMap<string, LangyQuestionCardData> | undefined;
}): LangyChoicesLockState | null {
  if (!waits || card.kind !== "choices") return null;
  const toolCallId = toolCallIdOfQuestionBlock(blockId);
  const wait = toolCallId ? waits.get(toolCallId) : undefined;
  if (!wait || wait.status === "pending") return null;
  const answered = langyAnsweredOptionIds({
    answers: wait.answers,
    options: card.options,
  });
  return answered ? { status: "answered", ...answered } : { status: "superseded" };
}

/**
 * Lines said with the `say` tool, drawn where they were said, in the reply's
 * own prose style. No frame, no activity row and never folded into the
 * receipt: the line was for the reader at that moment and stays there.
 */
function SayRun({ parts }: { parts: readonly unknown[] }) {
  const lines = parts
    .map((part) => sayToolText(part))
    .filter((line): line is string => line !== null);
  if (lines.length === 0) return null;
  return (
    <Box
      data-langy-say
      paddingX="2px"
      display="flex"
      flexDirection="column"
      gap={2}
      css={{
        "& > div > :first-child": { marginTop: 0 },
        "& > div > :last-child": { marginBottom: 0 },
        "& table": { display: "block", overflowX: "auto" },
      }}
    >
      {lines.map((line, index) => (
        <Markdown
          // A said line has no id of its own; its place in the run is stable.
          key={`${index}-${line.length}`}
          fontSize="langyAnswer"
          linkVariant="langy"
          color="langy.answerFg"
        >
          {line}
        </Markdown>
      ))}
    </Box>
  );
}

/** What a run is drawn against: the turn's own facts, shared by every run. */
type RunView = Omit<Parameters<typeof AnswerRun>[0], "parts" | "isStreaming" | "isRecorded"> & {
  isStreaming: boolean;
  isRecorded: boolean;
  reasoningTitles: Parameters<typeof LangyActivityParts>[0]["reasoningTitles"];
  lastActivityRunIndex: number;
  lastAnswerRunIndex: number;
};

/** One transcript run, drawn as what it is: the work, a said line, or the reply. */
function renderRun({
  run,
  index,
  view,
}: {
  run: LangyTranscriptRun;
  index: number;
  view: RunView;
}) {
  if (run.kind === "activity") {
    return (
      <LangyCardBoundary key={`activity-${index}`} scope="the tool activity">
        <LangyActivityParts
          parts={run.parts}
          // The receipt's thinking headlines belong to the turn, not to one run
          // of it, so they ride the last activity run.
          reasoningTitles={index === view.lastActivityRunIndex ? view.reasoningTitles : []}
          // A call is only ever closed by its own output, so off the streaming
          // turn an open call is an interrupted one.
          live={view.isStreaming}
          // The turn answered after this run, so a failure inside it is one the
          // turn recovered from.
          answeredAfter={index < view.lastAnswerRunIndex}
        />
      </LangyCardBoundary>
    );
  }
  if (run.kind === "say") {
    return <SayRun key={`say-${index}`} parts={run.parts} />;
  }
  return (
    <AnswerRun
      key={`answer-${index}`}
      parts={run.parts}
      isStreaming={view.isStreaming}
      isRecorded={view.isRecorded}
      hasActivity={view.hasActivity}
      projectSlug={view.projectSlug}
      pullRequestLinks={view.pullRequestLinks}
      choicesTimeline={view.choicesTimeline}
      onChoiceSelect={view.onChoiceSelect}
      onVerifyDerivedCard={view.onVerifyDerivedCard}
    />
  );
}
