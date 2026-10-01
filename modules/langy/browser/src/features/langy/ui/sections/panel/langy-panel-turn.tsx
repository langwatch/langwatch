import { IsolatedErrorBoundary } from "@langwatch/browser-host/isolated-error-boundary";
import { Box, chakra, HStack, IconButton, Text, VStack } from "@langwatch/design-system/primitives";
import type { LangyChoiceSelection, LangyDerivedChoicesCard } from "@langwatch/langy-contract";
import type { UIMessage } from "ai";
import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

import type { LangyTurnSignals } from "../../../../../behavior/use-langy-turn-signals.ts";
import type { resolveLangyActivityOwnership } from "../../../../../model/langy-activity-ownership.ts";
import type { langyPlan } from "../../../../../model/langy-plan.ts";
import { readableDate } from "../../../../../model/langy-row-format.ts";
import { LangyCardBoundary } from "../../../../../ui/elements/langy-card-boundary.tsx";
import { LangyDerivedCardView } from "../../../../../ui/sections/derived-cards/langy-derived-card-view.tsx";
import { LangyThinkingLine } from "../../../../../ui/sections/langy-thinking-line.tsx";
import { StreamingStatusLine } from "../../../../../ui/sections/streaming-status-line.tsx";
import type { LangyErrorPresentation } from "../../../behavior/logic/langy-error-explainer.ts";
import type { useLangyLocalWaits } from "../../../behavior/panel/use-langy-local-waits.ts";
import type { useLangyTranscriptReads } from "../../../behavior/panel/use-langy-panel-display.ts";
import type { useLangyTurnFailure } from "../../../behavior/panel/use-langy-turn-failure.ts";
import { useLangyDevLog } from "../../../behavior/stores/langy-dev-log.ts";
import { langyToolNarrator } from "../../../model/logic/langy-tool-narrator.ts";
import { LangyGitHubConnectCard } from "../github/langy-git-hub-connect-card.tsx";
import { LangyError } from "../langy-error.tsx";
import { LangyLocalPermissionCard } from "../langy-local-permission-card.tsx";
import { LangyPlanCard } from "../langy-plan-card.tsx";
import { LangyRecoveringLine } from "../langy-recovering-line.tsx";
import { panelGutter } from "./langy-panel-chrome.ts";

const MotionNotice = motion.create(Box);

type LocalWaits = ReturnType<typeof useLangyLocalWaits>;
type TurnFailure = ReturnType<typeof useLangyTurnFailure>;
type ErrorAction = NonNullable<LangyErrorPresentation["action"]>["kind"];

/**
 * The working lines of a running turn. Reasoning is a SIGNAL, never a surface: it only changes the
 * thinking line's words. A card holding the turn is named instead of escalating toward "stuck".
 */
export function LangyTurnWorkingLine({
  messages,
  signals,
  ownership,
  hasTurnDetail,
  hasInlineProgressOwner,
  awaitingAnswer,
  terminalConnected,
  activityKey,
  workerReady,
}: {
  messages: UIMessage[];
  signals: LangyTurnSignals;
  ownership: ReturnType<typeof resolveLangyActivityOwnership>;
  hasTurnDetail: boolean;
  hasInlineProgressOwner: boolean;
  awaitingAnswer: boolean;
  terminalConnected: boolean;
  activityKey: string;
  /** The panel-open warm proved this worker alive: "Thinking…", not the boot ladder. */
  workerReady: boolean;
}) {
  if (hasTurnDetail && ownership.showStandaloneSignals) {
    return (
      <VStack align="stretch" gap={2.5}>
        <StreamingStatusLine
          status={ownership.standaloneStatus}
          progress={ownership.standaloneProgress}
          progressSample={ownership.standaloneProgressSample}
          metrics={signals.metrics}
          segment={signals.segment}
        />
      </VStack>
    );
  }
  if (hasInlineProgressOwner) return <VStack align="stretch" gap={2.5} />;
  return (
    <VStack align="stretch" gap={2.5}>
      <LangyThinkingLine
        messages={messages}
        hasLiveReasoning={!!signals.reasoning}
        awaitingAnswer={awaitingAnswer}
        terminalConnected={terminalConnected}
        activityKey={activityKey}
        toolNarrator={langyToolNarrator}
        workerReady={workerReady}
      />
    </VStack>
  );
}

/** The cards a turn is waiting on: permission asks, and questions still open on their wait. */
export function LangyWaitingCards({
  projectId,
  conversationId,
  projectSlug,
  permissionCards,
  openQuestionParts,
  workspace,
  onChoiceSelect,
}: {
  projectId: string;
  conversationId: string;
  projectSlug: string | null;
  permissionCards: LocalWaits["permissionCards"];
  openQuestionParts: ReturnType<typeof useLangyTranscriptReads>["openQuestionParts"];
  workspace: LocalWaits["workspace"];
  onChoiceSelect: (answer: {
    selection: LangyChoiceSelection;
    card: LangyDerivedChoicesCard;
  }) => void;
}) {
  return (
    <>
      {permissionCards.map((card) => (
        <IsolatedErrorBoundary
          key={card.waitId}
          scope="This permission card failed to render"
          resetKeys={[card.waitId]}
        >
          <LangyLocalPermissionCard
            projectId={projectId}
            conversationId={conversationId}
            card={card}
            skipAllowed={workspace?.skipAllowed ?? false}
            skipPermissions={workspace?.skipPermissions ?? false}
          />
        </IsolatedErrorBoundary>
      ))}
      {openQuestionParts.map((part) => (
        <IsolatedErrorBoundary
          key={part.blockId}
          scope="This question failed to render"
          resetKeys={[part.blockId]}
        >
          <LangyDerivedCardView
            card={part.card}
            projectSlug={projectSlug}
            choicesLockState={{ status: "open" }}
            onChoiceSelect={onChoiceSelect}
          />
        </IsolatedErrorBoundary>
      ))}
    </>
  );
}

/**
 * The failure surface, in priority order: a pending auto-retry reads as a calm recovering line, a
 * missing integration is a setup card rather than an error, and anything that is not a composer
 * notice is a domain-error card — pinned out the moment a failure is known to auto-recover.
 */
export function LangyFailureSurface({
  floating,
  failure,
  organizationId,
  onGithubConnected,
}: {
  floating: boolean;
  failure: TurnFailure;
  organizationId: string | undefined;
  onGithubConnected: () => void;
}) {
  const surface = failureSurface({ failure, organizationId, onGithubConnected });
  if (!surface) return null;
  // Padded to the message column's own measure, since it sits outside that column.
  return (
    <Box paddingX={panelGutter(floating)} paddingBottom="12px">
      {surface}
    </Box>
  );
}

function failureSurface({
  failure,
  organizationId,
  onGithubConnected,
}: {
  failure: TurnFailure;
  organizationId: string | undefined;
  onGithubConnected: () => void;
}): ReactNode {
  const { recovery, needsGithubConnect, turnError, onErrorAction } = failure;
  if (recovery.isRecovering && recovery.message) {
    return <LangyRecoveringLine message={recovery.message} />;
  }
  if (needsGithubConnect && organizationId) {
    return (
      <LangyGitHubConnectCard organizationId={organizationId} onConnected={onGithubConnected} />
    );
  }
  if (!turnError || turnError.render === "composer-notice" || recovery.willAutoRecover) return null;
  return <LangyError presentation={turnError} onAction={onErrorAction} />;
}

/**
 * The running turn's plan, pinned between conversation and composer as a row of the column, so a
 * long turn's plan doesn't scroll away.
 */
export function LangyPinnedPlan({
  floating,
  plan,
}: {
  floating: boolean;
  plan: NonNullable<ReturnType<typeof langyPlan>>;
}) {
  return (
    <Box
      paddingX={panelGutter(floating)}
      paddingBottom="8px"
      maxHeight="34%"
      overflowY="auto"
      flexShrink={0}
    >
      <LangyCardBoundary scope="the plan">
        <LangyPlanCard plan={plan} isStreaming />
      </LangyCardBoundary>
    </Box>
  );
}

/**
 * "One turn at a time" is a WAIT, not a failure: a dismissable notice above the composer, the
 * draft kept in the field. It slides out of the composer instead of snapping.
 */
export function LangyComposerNotice({
  floating,
  presentation,
  onDismiss,
}: {
  floating: boolean;
  presentation: LangyErrorPresentation | null;
  onDismiss: () => void;
}) {
  const shown = presentation?.render === "composer-notice" ? presentation : null;
  return (
    <AnimatePresence initial={false}>
      {shown ? (
        <MotionNotice
          key="composer-notice"
          position="relative"
          overflow="hidden"
          paddingX={panelGutter(floating)}
          paddingBottom="6px"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
        >
          <LangyError presentation={shown} onAction={ignoreAction} />
          <IconButton
            aria-label="Dismiss"
            size="2xs"
            variant="ghost"
            color="fg.muted"
            position="absolute"
            top="6px"
            right={floating ? "25px" : "20px"}
            onClick={onDismiss}
          >
            <X size={13} />
          </IconButton>
        </MotionNotice>
      ) : null}
    </AnimatePresence>
  );
}

function ignoreAction(_kind: ErrorAction): void {}

/**
 * TIME TRAVEL veil: while the scrubber is off LIVE the composer is visible but inert — you cannot
 * send into, or stop, the past. The strip names the viewed moment and is the way back.
 */
export function LangyTimeTravelVeil({ floating, atMs }: { floating: boolean; atMs: number }) {
  return (
    <HStack paddingX={panelGutter(floating)} paddingBottom="4px" gap={2}>
      <Text textStyle="2xs" color="orange.fg" fontWeight="600">
        Viewing tape @ {atMs ? readableDate(atMs).toLocaleTimeString() : "start"}
      </Text>
      <chakra.button
        type="button"
        onClick={() => useLangyDevLog.getState().setScrub(null)}
        borderWidth={0}
        borderRadius="sm"
        paddingX={1.5}
        paddingY={0.5}
        cursor="pointer"
        textStyle="2xs"
        fontWeight="600"
        background="orange.subtle"
        color="orange.fg"
      >
        back to live
      </chakra.button>
    </HStack>
  );
}

/** The composer, inert while the past is on screen. */
export function LangyComposerSlot({ inert, children }: { inert: boolean; children: ReactNode }) {
  return (
    <Box
      pointerEvents={inert ? "none" : undefined}
      opacity={inert ? 0.55 : undefined}
      aria-hidden={inert ? true : undefined}
    >
      {children}
    </Box>
  );
}
