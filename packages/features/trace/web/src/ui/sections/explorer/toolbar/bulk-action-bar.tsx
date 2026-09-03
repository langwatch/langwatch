import { Button, HStack, Text } from "@chakra-ui/react";
import { Database, Download, Pencil, Sparkles } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { PersonalFeatureGateDialog } from "../../me/personal-feature-gate-dialog";
import { usePersonalFeatureGate } from "../../me/use-personal-feature-gate";
import { SelectionActionBar } from "../../../elements/selection-action-bar";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { useCanAskLangy } from "../../../../behavior/langy/use-can-ask-langy";
import { traceContextChip } from "@langwatch/langy-web";
import { useLangyStore } from "@langwatch/langy-web";
import { useDrawer } from "../../../../behavior/use-drawer";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project";
import { SELECT_ALL_MATCHING_CAP, useSelectionStore } from "../../../../index";
import { AddToAnnotationQueueDialog } from "../add-to-annotation-queue-dialog";

interface BulkActionBarProps {
  /** Total traces matching the active filter (for the "Select all N" hint). */
  totalHits: number;
  /** Trace IDs currently rendered on the page (used to detect "all visible selected"). */
  pageTraceIds: string[];
  /** Name lookup for the selected traces, so context chips read as names not ids. */
  traceNamesById: Record<string, string | undefined>;
  /** Open the export config dialog with the active selection. */
  onExportSelected: (traceIds: string[]) => void;
}

export const BulkActionBar: React.FC<BulkActionBarProps> = ({
  totalHits,
  pageTraceIds,
  traceNamesById,
  onExportSelected,
}) => {
  const mode = useSelectionStore((s) => s.mode);
  const traceIds = useSelectionStore((s) => s.traceIds);
  const enableAllMatching = useSelectionStore((s) => s.enableAllMatching);
  const clear = useSelectionStore((s) => s.clear);
  const { openDrawer } = useDrawer();
  const { hasPermission } = useOrganizationTeamProject();
  const datasetGate = usePersonalFeatureGate("datasets");
  const annotationGate = usePersonalFeatureGate("annotations");
  const [annotationQueueOpen, setAnnotationQueueOpen] = useState(false);
  const canQueueForAnnotation = hasPermission("annotations:create");
  // `langy:create`, not `langy:view`. This control exists to prime a question —
  // filling a composer that cannot send is a dead end that looks like a feature.
  const showLangy = useCanAskLangy();
  const attachContext = useLangyStore((s) => s.attachContext);
  const openLangyPanel = useLangyStore((s) => s.openPanel);

  const explicitCount = traceIds.size;
  const allMatchingCount = Math.min(totalHits, SELECT_ALL_MATCHING_CAP);
  const displayCount = mode === "all-matching" ? allMatchingCount : explicitCount;

  if (mode === "explicit" && explicitCount === 0) return null;

  const idsArray = Array.from(traceIds);
  const allPageRowsSelected =
    mode === "explicit" && pageTraceIds.length > 0 && pageTraceIds.every((id) => traceIds.has(id));
  const canSelectAllMatching = allPageRowsSelected && totalHits > pageTraceIds.length;
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
              <Button size="xs" variant="ghost" colorPalette="blue" onClick={enableAllMatching}>
                Select all {totalHits.toLocaleString()} matching
              </Button>
            )}
          </HStack>
        }
        onClear={clear}
      >
        <Button size="xs" variant="outline" onClick={() => onExportSelected(idsArray)}>
          <Download size={14} />
          Export selected
        </Button>

        {/* The selection's way into Langy: drop the checked traces into the
            composer's context and open the panel. Replaces the per-row
            hover "Absorb context" affordance. Explicit selection only —
            all-matching could be up to the 10k cap, far too many chips. */}
        {showLangy && (
          <Tooltip
            content="Disabled. Add to context requires explicit row selection."
            disabled={!isAllMatchingMode}
            showArrow
          >
            <Button
              size="xs"
              variant="outline"
              colorPalette="purple"
              disabled={isAllMatchingMode}
              onClick={() => {
                if (isAllMatchingMode) return;
                for (const id of idsArray) {
                  attachContext({
                    type: "trace",
                    id,
                    label: traceContextChip(id, traceNamesById[id]).label,
                  });
                }
                openLangyPanel();
              }}
            >
              <Sparkles size={14} />
              Add to context
            </Button>
          </Tooltip>
        )}

        {/* Explicit selection only, like add-to-dataset: the reviewer picks
            the traces a person will read, and a filter that matches 10k
            traces is not that. */}
        {canQueueForAnnotation && (
          <Tooltip
            content="Disabled. Add to annotation queue requires explicit row selection."
            disabled={!isAllMatchingMode}
            showArrow
          >
            <Button
              size="xs"
              variant="outline"
              disabled={isAllMatchingMode}
              onClick={async () => {
                if (isAllMatchingMode) return;
                const allowed = await annotationGate.requestEnable();
                if (!allowed) return;
                setAnnotationQueueOpen(true);
              }}
            >
              <Pencil size={14} />
              Add to annotation queue
            </Button>
          </Tooltip>
        )}

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
      <PersonalFeatureGateDialog state={annotationGate.dialogState} />
      <AddToAnnotationQueueDialog
        open={annotationQueueOpen}
        onClose={() => setAnnotationQueueOpen(false)}
        traceIds={idsArray}
      />
    </>
  );
};
