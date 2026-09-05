import { Button, Icon } from "@chakra-ui/react";
import { Zap } from "lucide-react";
import { useDrawer } from "../../../../behavior/use-drawer";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project";
import { getCurrentFilterText } from "../../../../index";

/**
 * Filtered traces → automation entry point (ADR-043).
 */
export const AutomateButton: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { hasPermission } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();

  if (!hasPermission("triggers:manage")) return null;

  return (
    <Tooltip
      content="Create an automation from the current filter"
      positioning={{ placement: "bottom" }}
    >
      <Button
        size="xs"
        variant="ghost"
        aria-label="Create an automation from the current filter"
        onClick={() =>
          openDrawer("automation", {
            initialSource: "trace",
            initialFilterQuery: getCurrentFilterText(),
          })
        }
      >
        <Icon boxSize={3.5}>
          <Zap />
        </Icon>
        {!compact && "Automate"}
      </Button>
    </Tooltip>
  );
};
