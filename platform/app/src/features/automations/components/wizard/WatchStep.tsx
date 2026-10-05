import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Lock, TrendingUp, Zap } from "lucide-react";
import { AlertType } from "~/generated/prisma/client";
import type { ConditionSource } from "../../logic/draftReducer";
import { useAutomationStore } from "../../state/automationStore";
import { useDraft } from "../../state/selectors";
import { CadenceSection } from "../CadenceSection";
import { SourceCard } from "../SourceCard";
import { SubjectSection } from "../SubjectSection";

/**
 * Why a saved automation's subject is fixed, in the words the API already
 * uses for the same refusal (`trigger_kind_immutable`): the graph slot is one
 * automation per graph, so converting one into the other is a create plus a
 * delete, not an edit.
 */
export const WATCH_LOCKED_EXPLANATION =
  "What this automation watches cannot change. Create a new automation to watch something else.";

/**
 * Step 1 of the merged wizard (ADR-093 §1, §4): the subject itself is the
 * opening question, and the rule shape follows the answer.
 *
 * There is no type card and no source card left to pick — choosing what to
 * watch *is* choosing what used to be the kind, so the old question is deleted
 * rather than renamed. A trace filter authors conditions with a live match
 * preview; a graph picks a graph and series and then the threshold rule.
 */
export function WatchStep({
  prefilledGraphId,
  subjectLocked = false,
  onCreateNew,
}: {
  prefilledGraphId?: string;
  /** A saved automation, or one opened from a specific chart, cannot change
   *  what it watches — the choice renders locked with the explanation. */
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
    // A graph-watching automation carries a severity, and the router refuses
    // one without it — seed it so the choice alone never blocks saving.
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
        {subjectLocked ? (
          <SubjectLockedNotice onCreateNew={onCreateNew} />
        ) : null}
      </VStack>

      <SubjectSection
        prefilledGraphId={prefilledGraphId}
        title={isWatchingGraph ? "The graph and series" : "Which traces"}
      />

      {/* A graph's threshold rule is part of what it watches: it decides when
          the automation FIRES, which is a different question from when it
          sends (that one rides with the channel, in Delivery). */}
      {isWatchingGraph ? <CadenceSection title="When it fires" /> : null}
    </VStack>
  );
}

/**
 * The lock, said once in prose rather than only in a tooltip on a card the
 * author may never hover — with the one action that actually resolves it.
 */
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
        <Button
          size="xs"
          variant="outline"
          flexShrink={0}
          onClick={onCreateNew}
        >
          New automation
        </Button>
      ) : null}
    </HStack>
  );
}
