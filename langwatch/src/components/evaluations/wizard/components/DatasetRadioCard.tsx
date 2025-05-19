import { RadioCard, Text, VStack } from "@chakra-ui/react";
import type { Dataset } from "@prisma/client";
import { Folder } from "react-feather";
import { OverflownTextWithTooltip } from "../../../OverflownText";

interface DatasetRadioCardProps {
  dataset: Dataset & { _count: { datasetRecords: number } };
  handleDatasetSelect: (datasetId: string) => void;
}

export function DatasetRadioCard({
  dataset,
  handleDatasetSelect,
}: DatasetRadioCardProps) {
  return (
    <RadioCard.Item
      value={dataset.id}
      width="full"
      minWidth={0}
      onClick={() => handleDatasetSelect(dataset.id)}
      _active={{ background: "blue.50" }}
    >
      <RadioCard.ItemHiddenInput />
      <RadioCard.ItemControl cursor="pointer" width="full">
        <RadioCard.ItemContent width="full">
          <VStack
            align="start"
            gap={3}
            _icon={{ color: "blue.300" }}
            width="full"
          >
            <Folder size={18} />
            <VStack align="start" gap={0} width="full">
              <OverflownTextWithTooltip wordBreak="break-all">
                {dataset.name}
              </OverflownTextWithTooltip>
              <Text fontSize="xs" color="gray.500" fontWeight="normal">
                {dataset._count.datasetRecords} entries
              </Text>
            </VStack>
          </VStack>
        </RadioCard.ItemContent>
        <RadioCard.ItemIndicator />
      </RadioCard.ItemControl>
    </RadioCard.Item>
  );
}
