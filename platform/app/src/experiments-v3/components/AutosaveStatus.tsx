import { Box, HStack, Text } from "@chakra-ui/react";
import { AlertCircle, Check, Cloud, CloudOff, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import type { AutosaveState } from "~/components/datasets/editor/DatasetTableContext";
import { Tooltip } from "@langwatch/design-system/tooltip";

type AutosaveStatusProps = {
  evaluationState: AutosaveState;
  datasetState: AutosaveState;
  evaluationError?: string;
  datasetError?: string;
};

/** The badge one combined state draws as. */
function statusContent({
  hasError,
  isOutOfDate,
  isSaving,
  isSaved,
}: {
  hasError: boolean;
  isOutOfDate: boolean;
  isSaving: boolean;
  isSaved: boolean;
}): { icon: ReactNode; text: string; color: string } {
  if (hasError) {
    return {
      icon: <AlertCircle size={14} />,
      text: "Failed to save",
      color: "red.fg",
    };
  }
  if (isOutOfDate) {
    return {
      icon: <CloudOff size={14} />,
      text: AUTOSAVE_OUT_OF_DATE_REASON,
      color: "orange.fg",
    };
  }
  if (isSaving) {
    return {
      icon: <RefreshCw size={12} />,
      text: "Saving...",
      color: "fg.muted",
    };
  }
  if (isSaved) {
    return { icon: <Check size={14} />, text: "Saved", color: "fg.subtle" };
  }
  return { icon: <Cloud size={14} />, text: "", color: "fg.subtle" };
}

/** The per-half detail behind the badge, one line each. */
function tooltipContent({
  evaluationState,
  datasetState,
  evaluationError,
  datasetError,
}: AutosaveStatusProps): string {
  const lines: string[] = [];

  if (evaluationState === "saving") {
    lines.push("Saving evaluation state...");
  } else if (evaluationState === "saved") {
    lines.push("Evaluation state saved");
  } else if (evaluationState === "error") {
    lines.push(
      evaluationError === AUTOSAVE_OUT_OF_DATE_REASON
        ? "A newer version was saved. Reload to get it. Your edits are still here until you do."
        : `Evaluation: ${evaluationError ?? "Failed to save"}`,
    );
  }

  if (datasetState === "saving") {
    lines.push("Syncing dataset records...");
  } else if (datasetState === "saved") {
    lines.push("Dataset records synced");
  } else if (datasetState === "error") {
    lines.push(`Dataset: ${datasetError ?? "Failed to sync"}`);
  }

  return lines.length > 0 ? lines.join("\n") : "All changes saved";
}

/**
 * Shows the combined autosave status for evaluation state and dataset records.
 * Displays "Saving...", "All changes saved", or error state.
 */
export function AutosaveStatus({
  evaluationState,
  datasetState,
  evaluationError,
  datasetError,
}: AutosaveStatusProps) {
  // A refused save and a failed save are different events and must not share a
  // label: the refusal wrote nothing and lost nothing, so "Failed to save"
  // tells the reader the opposite of what happened. A real failure alongside a
  // refusal still wins, because that one does need attention.
  const failures = [
    { state: evaluationState, reason: evaluationError },
    { state: datasetState, reason: datasetError },
  ].filter(({ state }) => state === "error");
  const hasError = failures.some(
    ({ reason }) => reason !== AUTOSAVE_OUT_OF_DATE_REASON,
  );
  const isOutOfDate = failures.length > 0 && !hasError;
  const isSaving = evaluationState === "saving" || datasetState === "saving";
  const isSaved =
    (evaluationState === "saved" || evaluationState === "idle") &&
    (datasetState === "saved" || datasetState === "idle");

  const status = statusContent({ hasError, isOutOfDate, isSaving, isSaved });

  return (
    <Tooltip
      content={tooltipContent({
        evaluationState,
        datasetState,
        evaluationError,
        datasetError,
      })}
    >
      <HStack
        gap={1.5}
        fontSize="xs"
        color={status.color}
        cursor="default"
        paddingX={2}
        paddingY={1}
        borderRadius="md"
        _hover={{ bg: "bg.subtle" }}
      >
        <Box>{status.icon}</Box>
        {status.text && <Text>{status.text}</Text>}
      </HStack>
    </Tooltip>
  );
}
