import { Box, HStack, Spinner, Text } from "@chakra-ui/react";
import { AlertCircle, Check, Cloud } from "lucide-react";
import { Tooltip } from "~/components/ui/tooltip";
import type { AutosaveState } from "../types";

type AutosaveStatusProps = {
  evaluationState: AutosaveState;
  datasetState: AutosaveState;
  evaluationError?: string;
  datasetError?: string;
};

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
  // Derive combined state - error takes priority, then saving, then saved
  const hasError = evaluationState === "error" || datasetState === "error";
  const isSaving = evaluationState === "saving" || datasetState === "saving";
  const isSaved =
    (evaluationState === "saved" || evaluationState === "idle") &&
    (datasetState === "saved" || datasetState === "idle");

  const getStatusContent = () => {
    if (hasError) {
      return {
        icon: <AlertCircle size={14} />,
        text: "Failed to save",
        color: "red.500",
      };
    }
    if (isSaving) {
      return {
        icon: <Spinner size="xs" />,
        text: "Saving...",
        color: "gray.500",
      };
    }
    if (isSaved) {
      return {
        icon: <Check size={14} />,
        text: "Saved",
        color: "gray.400",
      };
    }
    return {
      icon: <Cloud size={14} />,
      text: "",
      color: "gray.400",
    };
  };

  const status = getStatusContent();

  // Build tooltip content for details
  const getTooltipContent = () => {
    const lines: string[] = [];

    if (evaluationState === "saving") {
      lines.push("Saving evaluation state...");
    } else if (evaluationState === "saved") {
      lines.push("Evaluation state saved");
    } else if (evaluationState === "error") {
      lines.push(`Evaluation: ${evaluationError ?? "Failed to save"}`);
    }

    if (datasetState === "saving") {
      lines.push("Syncing dataset records...");
    } else if (datasetState === "saved") {
      lines.push("Dataset records synced");
    } else if (datasetState === "error") {
      lines.push(`Dataset: ${datasetError ?? "Failed to sync"}`);
    }

    return lines.length > 0 ? lines.join("\n") : "All changes saved";
  };

  return (
    <Tooltip content={getTooltipContent()}>
      <HStack
        gap={1.5}
        fontSize="xs"
        color={status.color}
        cursor="default"
        paddingX={2}
        paddingY={1}
        borderRadius="md"
        _hover={{ bg: "gray.50" }}
      >
        <Box>{status.icon}</Box>
        {status.text && <Text>{status.text}</Text>}
      </HStack>
    </Tooltip>
  );
}
