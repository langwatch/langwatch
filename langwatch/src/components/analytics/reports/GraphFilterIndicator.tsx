import { Box, VStack } from "@chakra-ui/react";
import { Filter } from "lucide-react";
import { FilterDisplay } from "~/components/triggers/FilterDisplay";
import { Tooltip } from "~/components/ui/tooltip";
import type { FilterField } from "~/server/filters/types";

interface GraphFilterIndicatorProps {
  filters: Record<FilterField, string[] | Record<string, string[]>>;
}

export function GraphFilterIndicator({ filters }: GraphFilterIndicatorProps) {
  return (
    <Tooltip
      content={
        <VStack
          align="start"
          backgroundColor="black"
          color="white"
          height="100%"
          textWrap="wrap"
        >
          <FilterDisplay filters={filters} />
        </VStack>
      }
      positioning={{ placement: "top" }}
      showArrow
    >
      <Box padding={1}>
        <Filter width={16} style={{ minWidth: 16 }} />
      </Box>
    </Tooltip>
  );
}

