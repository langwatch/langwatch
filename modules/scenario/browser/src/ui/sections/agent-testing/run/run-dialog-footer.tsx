/**
 * The two actions of the run dialog: leave it, or queue the run.
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { Box, chakra, HStack, Text } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Phone, Play } from "lucide-react";
import { useId } from "react";

import { SmallButton } from "../../../elements/agent-testing/shared/small-button.tsx";
import type { RunDialogController } from "./use-run-dialog-submit.ts";

/**
 * What the run control reads, given how many scenarios the subject covers
 * and, in a comparison, how many targets it goes against.
 */
export function runButtonLabel({
  caseCount,
  targetCount,
}: {
  caseCount: number | null;
  targetCount: number;
}): string {
  if (caseCount === null) return "Run";
  const scenarios = caseCount === 1 ? "Run 1 scenario" : `Run ${caseCount} scenarios`;
  return targetCount > 1 ? `${scenarios} × ${targetCount} targets` : scenarios;
}

export function RunDialogFooter({
  controller,
  isRunBlocked,
  caseCount,
  targetCount,
  blockedReason,
  warning,
  onRun,
  onCallItMyself,
  onClose,
}: {
  controller: RunDialogController;
  isRunBlocked: boolean;
  /** How many scenarios the run covers, or nothing when it is not known. */
  caseCount: number | null;
  /** How many targets the run goes against. */
  targetCount: number;
  /** Why the run cannot start, printed beside the button. */
  blockedReason: string | null;
  /** What holds Run instead of running: the button stays enabled and says so. */
  warning?: string | null;
  /** What Run does. Defaults to queueing the run. */
  onRun?: () => void;
  /** Offered beside Run only for a voice-agent target (AC23, AC25). */
  onCallItMyself?: () => void;
  onClose: () => void;
}) {
  const reasonId = useId();
  const reason = blockedReason;
  const runButton = (
    <SmallButton
      variant="solid"
      colorPalette="orange"
      disabled={isRunBlocked}
      loading={controller.isBusy}
      onClick={onRun ?? (() => void controller.run())}
      data-testid="run-dialog-run"
      data-warning={warning ?? undefined}
      aria-describedby={reason ? reasonId : undefined}
    >
      <Play size={13} />
      {runButtonLabel({ caseCount, targetCount })}
    </SmallButton>
  );
  return (
    <HStack width="full" gap={2}>
      {reason ? (
        <Text
          id={reasonId}
          textStyle="caption"
          color="fg.muted"
          data-testid="run-dialog-blocked-reason"
        >
          {reason}
        </Text>
      ) : null}
      <Box flex={1} />
      <chakra.button
        type="button"
        onClick={onClose}
        disabled={controller.isBusy}
        paddingX={3}
        height="28px"
        borderRadius="lg"
        textStyle="caption"
        fontWeight="medium"
        color="fg.muted"
        cursor="pointer"
        boxShadow="none"
        _hover={{ background: "bg.muted", color: "fg" }}
        _disabled={{ cursor: "not-allowed", opacity: 0.5 }}
      >
        Cancel
      </chakra.button>
      {onCallItMyself ? (
        <SmallButton
          variant="outline"
          disabled={controller.isBusy}
          onClick={onCallItMyself}
          data-testid="run-dialog-call-it-myself"
        >
          <Phone size={13} />
          Call it myself
        </SmallButton>
      ) : null}
      {!isRunBlocked && warning ? (
        <Tooltip content={warning}>
          <Box as="span" display="inline-flex">
            {runButton}
          </Box>
        </Tooltip>
      ) : (
        runButton
      )}
    </HStack>
  );
}
