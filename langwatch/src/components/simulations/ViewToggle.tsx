import { HStack, IconButton } from "@chakra-ui/react";
import { Grid, List } from "react-feather";

export enum ViewMode {
  Grid = "grid",
  Table = "table",
}

interface ViewToggleProps {
  currentView: ViewMode;
  onViewChange: (view: ViewMode) => void;
}

export function ViewToggle({ currentView, onViewChange }: ViewToggleProps) {
  return (
    <HStack gap={1} bg="gray.100" borderRadius="md" p={1}>
      <IconButton
        aria-label="Grid view"
        size="sm"
        variant={currentView === ViewMode.Grid ? "solid" : "ghost"}
        colorPalette={currentView === ViewMode.Grid ? "blue" : "gray"}
        onClick={() => onViewChange(ViewMode.Grid)}
      >
        <Grid size={16} />
      </IconButton>
      <IconButton
        aria-label="Table view"
        size="sm"
        variant={currentView === ViewMode.Table ? "solid" : "ghost"}
        colorPalette={currentView === ViewMode.Table ? "blue" : "gray"}
        onClick={() => onViewChange(ViewMode.Table)}
      >
        <List size={16} />
      </IconButton>
    </HStack>
  );
}
