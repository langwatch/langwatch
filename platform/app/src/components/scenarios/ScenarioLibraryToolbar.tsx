import { Button, HStack } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { LabelFilterDropdown } from "./LabelFilterDropdown";

type ScenarioLibraryToolbarProps = {
  allLabels: string[];
  activeLabels: string[];
  onLabelToggle: (label: string) => void;
  onNewClick: () => void;
};

/**
 * Toolbar for the scenario library page with filter controls and actions.
 */
export function ScenarioLibraryToolbar({
  allLabels,
  activeLabels,
  onLabelToggle,
  onNewClick,
}: ScenarioLibraryToolbarProps) {
  return (
    <HStack gap={2}>
      <LabelFilterDropdown
        allLabels={allLabels}
        activeLabels={activeLabels}
        onToggle={onLabelToggle}
      />
      <Button size="sm" colorPalette="blue" onClick={onNewClick}>
        <Plus size={16} /> New Scenario
      </Button>
    </HStack>
  );
}
