import { DatasetGenerationTemplate } from "./DatasetGenerationTemplate";
import { Download } from "react-feather";
import { Text } from "@chakra-ui/react";

interface DatasetFromProductionConfigurationProps {
  selectedDataSetId: string;
}

export function DatasetFromProductionConfiguration({
  selectedDataSetId,
}: DatasetFromProductionConfigurationProps) {
  return (
    <DatasetGenerationTemplate>
      <DatasetGenerationTemplate.Header icon={<Download size={16} />}>
        Import from Production
      </DatasetGenerationTemplate.Header>
      <DatasetGenerationTemplate.Description>
        Import tracing data from production to test the evaluator
      </DatasetGenerationTemplate.Description>
      <DatasetGenerationTemplate.Content>
        {selectedDataSetId ? (
          <Text>Current dataset: {selectedDataSetId}</Text>
        ) : (
          <>
            <Text>
              Please create a new dataset from the production data table to
              continue
            </Text>
          </>
        )}
      </DatasetGenerationTemplate.Content>
    </DatasetGenerationTemplate>
  );
}
