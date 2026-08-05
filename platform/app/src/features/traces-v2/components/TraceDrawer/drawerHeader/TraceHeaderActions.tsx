import { Button, Icon } from "@chakra-ui/react";
import { LuDatabase, LuPenLine, LuShare2 } from "react-icons/lu";
import { PersonalFeatureGateDialog } from "~/components/me/PersonalFeatureGateDialog";
import { usePersonalFeatureGate } from "~/components/me/usePersonalFeatureGate";
import { Tooltip } from "~/components/ui/tooltip";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

interface TraceHeaderActionsProps {
  traceId: string;
  /** Opens the share dialog, rendered by the header. */
  onShare: () => void;
  /** Opens the annotation-queue dialog, rendered by the header. Called only
   * after the personal-workspace gate allows it. */
  onOpenQueueDialog: () => void;
}

/**
 * The high-frequency trace actions, promoted out of the overflow menu so they
 * are findable at a glance: share, annotate, add to dataset.
 */
export function TraceHeaderActions({
  traceId,
  onShare,
  onOpenQueueDialog,
}: TraceHeaderActionsProps) {
  const { hasPermission } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();
  const annotationsGate = usePersonalFeatureGate("annotations");

  const canShare = hasPermission("traces:share");
  const canQueueForAnnotation = hasPermission("annotations:manage");

  return (
    <>
      {canShare && (
        <Tooltip content="Share" positioning={{ placement: "bottom" }}>
          <Button
            size="xs"
            variant="ghost"
            onClick={onShare}
            aria-label="Share trace"
          >
            <Icon as={LuShare2} boxSize={3.5} />
          </Button>
        </Tooltip>
      )}
      {canQueueForAnnotation && (
        <Tooltip
          content="Add to annotation queue"
          positioning={{ placement: "bottom" }}
        >
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              void annotationsGate.requestEnable().then((allowed) => {
                if (allowed) onOpenQueueDialog();
              });
            }}
            aria-label="Add to annotation queue"
          >
            <Icon as={LuPenLine} boxSize={3.5} />
          </Button>
        </Tooltip>
      )}
      <Tooltip content="Add to dataset" positioning={{ placement: "bottom" }}>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => openDrawer("addDatasetRecord", { traceId })}
          aria-label="Add trace to dataset"
        >
          <Icon as={LuDatabase} boxSize={3.5} />
        </Button>
      </Tooltip>
      <PersonalFeatureGateDialog state={annotationsGate.dialogState} />
    </>
  );
}
