import { AlertType } from "@langwatch/automation-contract";
import { Box, Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { Lock, TrendingUp, Zap } from "lucide-react";

import { SourceCard } from "../elements/source-card.tsx";
import { useDraft } from "./automation-selectors.ts";
import { useAutomationStore } from "./automation-store.ts";
import { CadenceSection } from "./cadence-section-adapter.tsx";
import type { ConditionSource } from "./draft-model.ts";
import { SubjectSection } from "./subject-section.tsx";

/** Why a saved automation's subject is fixed, in the API's words for the same
 *  refusal (`trigger_kind_immutable`): converting one is a create plus a delete. */
export const WATCH_LOCKED_EXPLANATION =
  "What this automation watches cannot change. Create a new automation to watch something else.";

/**
 * Step 1 of the wizard (ADR-093 §1, §4): what to watch is the opening question,
 * and the rule shape follows the answer. A trace filter authors conditions with
 * a live match preview; a graph picks a graph and series, then the threshold.
 */
export function WatchStep({
  prefilledGraphId,
  subjectLocked = false,
  onCreateNew,
}: {
  prefilledGraphId?: string;
  /** A saved automation, or one opened from a specific chart, cannot change what it watches. */
  subjectLocked?: boolean;
  /** Offers the way out the lock implies: start a fresh automation. */
  onCreateNew?: () => void;
}) {
  const draft = useDraft();
  const dispatch = useAutomationStore((s) => s.dispatch);
  const isWatchingGraph = draft.source === "customGraph";

  const pick = (source: ConditionSource) => {
    if (source === draft.source) return;
    dispatch({ type: "SET_SOURCE", value: source });
    // A graph-watching automation carries a severity and the router refuses
    // one without it, so the choice alone never blocks saving.
    if (source === "customGraph" && draft.alertType === null) {
      dispatch({ type: "SET_ALERT_TYPE", value: AlertType.WARNING });
    }
  };

  return (
    <VStack align="stretch" gap={3}>
      <VStack align="stretch" gap={2}>
        <Text fontWeight="semibold">What should this automation watch?</Text>
        <HStack gap={2} align="stretch">
          <SourceCard
            active={!isWatchingGraph}
            title="A trace filter"
            description="Act on every incoming trace that matches your conditions."
            accent="blue"
            icon={<Zap size={16} />}
            locked={subjectLocked && isWatchingGraph}
            lockedTooltip={WATCH_LOCKED_EXPLANATION}
            onClick={() => pick("trace")}
          />
          <SourceCard
            active={isWatchingGraph}
            title="A graph"
            description="Watch one series on an analytics graph and fire when it crosses a threshold."
            accent="orange"
            icon={<TrendingUp size={16} />}
            locked={subjectLocked && !isWatchingGraph}
            lockedTooltip={WATCH_LOCKED_EXPLANATION}
            onClick={() => pick("customGraph")}
          />
        </HStack>
        {subjectLocked ? <SubjectLockedNotice onCreateNew={onCreateNew} /> : null}
      </VStack>

      <SubjectSection
        prefilledGraphId={prefilledGraphId}
        title={isWatchingGraph ? "The graph and series" : "Which traces"}
      />

      {/* A graph's threshold decides when it FIRES; when it sends rides with
          the channel, in Delivery. */}
      {isWatchingGraph ? <CadenceSection title="When it fires" /> : null}
    </VStack>
  );
}

/** The lock said once in prose, with the one action that resolves it. */
function SubjectLockedNotice({ onCreateNew }: { onCreateNew?: () => void }) {
  return (
    <HStack
      gap={2}
      align="center"
      padding={2.5}
      borderRadius="md"
      borderWidth="1px"
      borderColor="border"
      bg="bg.subtle"
    >
      <Box color="fg.muted" flexShrink={0} display="inline-flex">
        <Lock size={13} aria-hidden="true" />
      </Box>
      <Text textStyle="xs" color="fg.muted" flex="1" minWidth="0">
        {WATCH_LOCKED_EXPLANATION}
      </Text>
      {onCreateNew ? (
        <Button size="xs" variant="outline" flexShrink={0} onClick={onCreateNew}>
          New automation
        </Button>
      ) : null}
    </HStack>
  );
}
