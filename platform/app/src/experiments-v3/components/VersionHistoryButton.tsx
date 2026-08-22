/**
 * VersionHistoryButton - open the workbench's version history.
 *
 * Sits beside the results button in the workbench header. It opens the
 * version-history drawer, which lists every saved setup and can bring one
 * back.
 */
import { Button } from "@chakra-ui/react";
import { History } from "lucide-react";
import { Tooltip } from "~/components/ui/tooltip";
import { useEvaluationsV3Store } from "~/experiments-v3/hooks/useEvaluationsV3Store";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

type VersionHistoryButtonProps = {
  disabled?: boolean;
};

export function VersionHistoryButton({
  disabled = false,
}: VersionHistoryButtonProps) {
  const { project } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();

  const { experimentId, experimentSlug } = useEvaluationsV3Store((state) => ({
    experimentId: state.experimentId,
    experimentSlug: state.experimentSlug,
  }));

  // Nothing has a history until it has been saved once.
  if (!project || !experimentId || !experimentSlug) return null;

  return (
    <Tooltip
      content="Version history"
      showArrow
      positioning={{ placement: "bottom" }}
      openDelay={100}
    >
      <Button
        size="sm"
        variant="ghost"
        color="fg.muted"
        _hover={{ color: "fg", bg: "bg.subtle" }}
        disabled={disabled}
        aria-label="Version history"
        onClick={() =>
          openDrawer("versionHistory", { experimentId, experimentSlug })
        }
      >
        <History size={18} />
        History
      </Button>
    </Tooltip>
  );
}
