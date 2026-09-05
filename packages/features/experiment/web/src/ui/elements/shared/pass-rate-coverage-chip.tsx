import { HStack, Icon, Text } from "@chakra-ui/react";
import { LuTriangleAlert } from "react-icons/lu";
import { passRateCoverage } from "../../../model/shared/pass-rate-coverage";

/**
 * The row count that belongs beside a rate covering part of a dataset.
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
