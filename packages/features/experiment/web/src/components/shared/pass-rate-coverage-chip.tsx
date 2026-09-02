import { HStack, Icon, Text } from "@chakra-ui/react";
import { LuTriangleAlert } from "react-icons/lu";
import { passRateCoverage } from "./pass-rate-coverage";

/**
 * The row count that belongs beside a rate covering part of a dataset.
 *
 * Draws nothing when the rate covers every row, so a caller renders it
 * unconditionally and never has to repeat the completeness test. The workbench
 * header and the results page both use it, so a reader sees the same mark and
 * the same numbers whichever surface they are on.
 */
export const PassRateCoverageChip = ({
  completedRows,
  totalRows,
}: {
  completedRows: number;
  totalRows: number;
}) => {
  if (passRateCoverage({ completedRows, totalRows }).isComplete) return null;

  return (
    <HStack gap={1}>
      <Icon as={LuTriangleAlert} boxSize={3} color="orange.fg" />
      <Text color="orange.fg" fontWeight="medium">
        {completedRows}/{totalRows}
      </Text>
    </HStack>
  );
};
