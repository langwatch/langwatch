import { Button, HStack, Text } from "@chakra-ui/react";
import { Archive, Edit2, Play } from "lucide-react";
import { Tooltip } from "~/components/ui/tooltip";

interface ScenarioRunActionsProps {
  /** The scenario data, or null/undefined if not found. */
  scenario: { archivedAt: Date | null } | null | undefined;
  /** Whether the scenario is currently being run. */
  isRunning: boolean;
  /** Called when the user clicks "Run Again". */
  onRunAgain: () => void;
  /** Called when the user clicks "Edit Scenario". */
  onEditScenario: () => void;
}

/**
 * Action buttons for the scenario run results page header.
 *
 * Shows "Run Again" and "Edit Scenario" buttons when the scenario exists.
 * When the scenario has been archived, "Run Again" is disabled with a tooltip
 * and an archived notice is displayed.
 */
export function ScenarioRunActions({
  scenario,
  isRunning,
  onRunAgain,
  onEditScenario,
}: ScenarioRunActionsProps) {
  if (!scenario) {
    return null;
  }

  const isArchived = scenario.archivedAt !== null;

  return (
    <HStack gap={2}>
      {isArchived && (
        <HStack gap={1} color="fg.muted" fontSize="sm">
          <Archive size={14} />
          <Text>This scenario has been archived</Text>
        </HStack>
      )}
      <Tooltip
        content="This scenario has been archived and cannot be run"
        disabled={!isArchived}
      >
        <Button
          colorPalette="blue"
          size="sm"
          onClick={onRunAgain}
          loading={isRunning}
          disabled={isArchived}
        >
          <Play size={14} />
          Run Again
        </Button>
      </Tooltip>
      {!isArchived && (
        <Button variant="outline" size="sm" onClick={onEditScenario}>
          <Edit2 size={14} />
          Edit Scenario
        </Button>
      )}
    </HStack>
  );
}
