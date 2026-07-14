import { Button, HStack, Text } from "@chakra-ui/react";
import { Database, Download } from "lucide-react";
import type React from "react";
import { PersonalFeatureGateDialog } from "~/components/me/PersonalFeatureGateDialog";
import { usePersonalFeatureGate } from "~/components/me/usePersonalFeatureGate";
import { SelectionActionBar } from "~/components/ui/SelectionActionBar";
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
  const datasetGate = usePersonalFeatureGate("datasets");

  const explicitCount = traceIds.size;
  const allMatchingCount = Math.min(totalHits, SELECT_ALL_MATCHING_CAP);
  const displayCount =
    mode === "all-matching" ? allMatchingCount : explicitCount;

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
    <>
      <SelectionActionBar
        label={
          <HStack gap={2} align="center">
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
          </HStack>
        }
        onClear={clear}
      >
        <Button
          size="xs"
          variant="outline"
          onClick={() => onExportSelected(idsArray)}
        >
          <Download size={14} />
          Export selected
        </Button>

        <Tooltip
          content="Disabled. Add to dataset requires explicit row selection."
          disabled={!isAllMatchingMode}
          showArrow
        >
          <Button
            size="xs"
            variant="outline"
            disabled={isAllMatchingMode}
            onClick={async () => {
              if (isAllMatchingMode) return;
              const allowed = await datasetGate.requestEnable();
              if (!allowed) return;
              openDrawer("addDatasetRecord", {
                selectedTraceIds: idsArray,
              });
            }}
          >
            <Database size={14} />
            Add to dataset
          </Button>
        </Tooltip>
      </SelectionActionBar>
      <PersonalFeatureGateDialog state={datasetGate.dialogState} />
    </>
  );
};
