import { Button, Icon } from "@chakra-ui/react";
import { Zap } from "lucide-react";
import { useDrawer } from "~/components/CurrentDrawer";
import { Tooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { getCurrentFilterText } from "../../stores/filterStore";

/**
 * Filtered traces → automation entry point (ADR-043).
 *
 * Turns the current Traces-V2 search query into a new trace-subject
 * automation: opens the automation drawer pre-seeded with the applied
 * filter as its Subject (`initialFilterQuery`). The drawer persists the
 * query on `Trigger.filterQuery`, and the dispatcher matches it in-memory
 * against every settling trace — no per-trace ClickHouse round-trip.
 */
export const AutomateButton: React.FC<{ compact?: boolean }> = ({
  compact = false,
}) => {
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
