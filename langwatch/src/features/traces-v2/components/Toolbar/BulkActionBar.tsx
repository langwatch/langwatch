import { Box, Button, HStack, Text } from "@chakra-ui/react";
import { Database, Download, X } from "lucide-react";
import type React from "react";
import { Tooltip } from "~/components/ui/tooltip";
import { useDrawer } from "~/hooks/useDrawer";
import {
  SELECT_ALL_MATCHING_CAP,
  useSelectionStore,
} from "../../stores/selectionStore";

interface BulkActionBarProps {
  /** Total traces matching the active filter (for the "Select all N" hint). */
  totalHits: number;
  /** Trace IDs currently rendered on the page (used to detect "all visible selected"). */
  pageTraceIds: string[];
  /** Open the export config dialog with the active selection. */
  onExportSelected: (traceIds: string[]) => void;
}

export const BulkActionBar: React.FC<BulkActionBarProps> = ({
  totalHits,
  pageTraceIds,
  onExportSelected,
}) => {
  const mode = useSelectionStore((s) => s.mode);
  const traceIds = useSelectionStore((s) => s.traceIds);
  const enableAllMatching = useSelectionStore((s) => s.enableAllMatching);
  const clear = useSelectionStore((s) => s.clear);
  const { openDrawer } = useDrawer();

  const explicitCount = traceIds.size;
  const allMatchingCount = Math.min(totalHits, SELECT_ALL_MATCHING_CAP);
  const displayCount = mode === "all-matching" ? allMatchingCount : explicitCount;

  if (mode === "explicit" && explicitCount === 0) return null;

  const idsArray = Array.from(traceIds);
  const allPageRowsSelected =
    mode === "explicit" &&
    pageTraceIds.length > 0 &&
    pageTraceIds.every((id) => traceIds.has(id));
  const canSelectAllMatching =
    allPageRowsSelected && totalHits > pageTraceIds.length;
  const isAllMatchingMode = mode === "all-matching";
  const allMatchingHitsCap = totalHits >= SELECT_ALL_MATCHING_CAP;

  return (
    <Box
      position="fixed"
      bottom={6}
      left="50%"
      transform="translateX(-50%)"
      zIndex={20}
      bg="bg.emphasized"
      paddingX={3}
      paddingY={2}
      borderRadius="md"
      borderWidth="1px"
      borderColor="border.muted"
      boxShadow="lg"
    >
      <HStack gap={2} align="center" whiteSpace="nowrap">
        <Text textStyle="sm" fontWeight="medium">
          {isAllMatchingMode && allMatchingHitsCap
            ? `${allMatchingCount.toLocaleString()} selected (max)`
            : `${displayCount.toLocaleString()} selected`}
        </Text>

        {canSelectAllMatching && (
          <Button
            size="xs"
            variant="ghost"
            colorPalette="blue"
            onClick={enableAllMatching}
          >
            Select all {totalHits.toLocaleString()} matching
          </Button>
        )}

        <Box width="1px" height="20px" bg="border.muted" marginX={1} />

        <Button
          size="xs"
          variant="outline"
          onClick={() => onExportSelected(idsArray)}
        >
          <Download size={14} />
          Export selected
        </Button>

        <Tooltip
          content="Disabled — add to dataset requires explicit row selection."
          disabled={!isAllMatchingMode}
          showArrow
        >
          <Button
            size="xs"
            variant="outline"
            disabled={isAllMatchingMode}
            onClick={() => {
              if (isAllMatchingMode) return;
              openDrawer("addDatasetRecord", {
                selectedTraceIds: idsArray,
              });
            }}
          >
            <Database size={14} />
            Add to dataset
          </Button>
        </Tooltip>

        <Button size="xs" variant="ghost" onClick={clear} aria-label="Clear selection">
          <X size={14} />
        </Button>
      </HStack>
    </Box>
  );
};
