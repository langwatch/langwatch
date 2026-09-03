import { Box, Button, Input } from "@chakra-ui/react";
import { Search } from "lucide-react";

export function PipelineTreeFilter({
  filter,
  onFilterChange,
  onExpandAll,
  onCollapseAll,
}: {
  filter: string;
  onFilterChange: (next: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}) {
  return (
    <>
      <Box position="relative" width="200px">
        <Box position="absolute" left={2.5} top="50%" transform="translateY(-50%)" zIndex={1}>
          <Search size={11} color="var(--chakra-colors-fg-muted)" />
        </Box>
        <Input
          size="xs"
          aria-label="Filter pipelines"
          placeholder="Filter..."
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          paddingLeft={7}
        />
      </Box>
      <Button variant="ghost" size="2xs" onClick={onExpandAll}>
        Expand all
      </Button>
      <Button variant="ghost" size="2xs" onClick={onCollapseAll}>
        Collapse
      </Button>
    </>
  );
}
