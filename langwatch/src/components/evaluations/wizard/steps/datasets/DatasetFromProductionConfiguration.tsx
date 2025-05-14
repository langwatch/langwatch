import { DatasetGenerationTemplate } from "./DatasetGenerationTemplate";
import { Download } from "react-feather";
import { Text, RadioCard } from "@chakra-ui/react";
import type { Dataset } from "@prisma/client";
import { DatasetRadioCard } from "../../components/DatasetRadioCard";
interface DatasetFromProductionConfigurationProps {
  dataset?: Dataset & { _count: { datasetRecords: number } };
}

export function DatasetFromProductionConfiguration({
  dataset,
}: DatasetFromProductionConfigurationProps) {
  return (
    <DatasetGenerationTemplate>
      <DatasetGenerationTemplate.Header icon={<Download size={16} />}>
        Select Production Data
      </DatasetGenerationTemplate.Header>
      <DatasetGenerationTemplate.Description>
        {!dataset &&
          "Import tracing data from production to test the evaluator"}
      </DatasetGenerationTemplate.Description>
      <DatasetGenerationTemplate.Content>
        {dataset ? (
          // It's weird to use the radio card here, but this keeps consistent styling
          <RadioCard.Root
            variant="outline"
            colorPalette="blue"
            value={dataset.id}
            width="full"
          >
            <DatasetRadioCard
              dataset={dataset}
              handleDatasetSelect={() => {}}
            />
          </RadioCard.Root>
        ) : (
          <>
            <Text>
              Please create a new dataset from the production data table to
              continue.
            </Text>
          </>
        )}
      </DatasetGenerationTemplate.Content>
    </DatasetGenerationTemplate>
  );
}
