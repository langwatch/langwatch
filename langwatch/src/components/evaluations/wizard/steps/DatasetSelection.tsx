import {
  Accordion,
  Button,
  Grid,
  Heading,
  HStack,
  RadioCard,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useState } from "react";
import {
  ChevronDown,
  Database,
  FilePlus,
  FileText,
  Folder,
  UploadCloud,
} from "react-feather";
import { useEvaluationWizardStore } from "~/hooks/useEvaluationWizardStore";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { StepButton } from "../../StepButton";
import { OverflownTextWithTooltip } from "../../../OverflownText";

export function DatasetSelection() {
  const { setWizardState, wizardState } = useEvaluationWizardStore();
  const { project } = useOrganizationTeamProject();

  const [accordeonValue, setAccordeonValue] = useState(
    wizardState.dataSource ? ["configuration"] : ["data-source"]
  );

  // Fetch datasets
  const datasets = api.dataset.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project }
  );

  const handleDataSourceSelect = (
    dataSource: "choose" | "from_production" | "manual" | "upload"
  ) => {
    setWizardState({
      dataSource,
    });
    setAccordeonValue(["configuration"]);
  };

  const handleDatasetSelect = (datasetId: string) => {
    setWizardState({
      datasetId,
    });
  };

  const handleContinue = (
    dataSource: "from_production" | "manual" | "upload"
  ) => {
    setWizardState({
      step: "executor",
      dataSource,
    });
  };

  return (
    <VStack width="full" align="start" gap={4}>
      <VStack align="start" paddingTop={6}>
        <Heading as="h2" size="md">
          Datasets
        </Heading>
        <Text>Choose where your evaluation data will come from</Text>
      </VStack>

      <Accordion.Root
        value={accordeonValue}
        onValueChange={(e) => setAccordeonValue(e.value)}
        multiple={false}
        collapsible
        width="full"
        variant="plain"
      >
        {/* First Accordion - Data Source Selection */}
        <VStack width="full" gap={3}>
          <Accordion.Item value="data-source" width="full" paddingY={2}>
            {wizardState.dataSource && (
              <Accordion.ItemTrigger width="full" paddingX={2} paddingY={3}>
                <HStack width="full" alignItems="center">
                  <VStack width="full" align="start" gap={1}>
                    Data Source
                  </VStack>
                </HStack>
                <Accordion.ItemIndicator>
                  <ChevronDown />
                </Accordion.ItemIndicator>
              </Accordion.ItemTrigger>
            )}
            <Accordion.ItemContent paddingTop={2}>
              <VStack width="full" gap={3}>
                <StepButton
                  title="Choose existing dataset"
                  description="Select from your previously created datasets"
                  onClick={() => handleDataSourceSelect("choose")}
                  _icon={{ color: "blue.400" }}
                  icon={<Database />}
                  indicator={null}
                />

                <StepButton
                  title="Import from Production"
                  description="Import tracing data from production to test the evaluator"
                  onClick={() => handleDataSourceSelect("from_production")}
                  _icon={{ color: "blue.400" }}
                  icon={<FileText />}
                  indicator={null}
                  disabled
                />

                <StepButton
                  title="Create manually"
                  description="Insert some initial test data manually, use AI to expand it"
                  onClick={() => handleDataSourceSelect("manual")}
                  _icon={{ color: "blue.400" }}
                  icon={<FilePlus />}
                  indicator={null}
                  disabled
                />

                <StepButton
                  title="Upload CSV"
                  description="Upload your pre-existing dataset from Excel or CSV"
                  onClick={() => handleDataSourceSelect("upload")}
                  _icon={{ color: "blue.400" }}
                  icon={<UploadCloud />}
                  indicator={null}
                  disabled
                />
              </VStack>
            </Accordion.ItemContent>
          </Accordion.Item>
        </VStack>

        {/* Second Accordion - Configuration Options */}
        {wizardState.dataSource && (
          <VStack width="full" gap={3}>
            <Accordion.Item value="configuration" width="full">
              <Accordion.ItemTrigger width="full">
                <HStack
                  width="full"
                  alignItems="center"
                  paddingX={2}
                  paddingY={3}
                >
                  <VStack width="full" align="start" gap={1}>
                    <Text>
                      {wizardState.dataSource === "choose" && "Select Dataset"}
                      {wizardState.dataSource === "from_production" &&
                        "Import from Production"}
                      {wizardState.dataSource === "manual" &&
                        "Create Dataset Manually"}
                      {wizardState.dataSource === "upload" && "Upload CSV"}
                    </Text>
                  </VStack>
                  <Accordion.ItemIndicator>
                    <ChevronDown />
                  </Accordion.ItemIndicator>
                </HStack>
              </Accordion.ItemTrigger>
              <Accordion.ItemContent paddingTop={2} paddingX="1px">
                {wizardState.dataSource === "choose" && (
                  <VStack width="full" align="start" gap={3}>
                    {datasets.isLoading && <Text>Loading datasets...</Text>}
                    {datasets.error && (
                      <Text color="red.500">
                        Error loading datasets: {datasets.error.message}
                      </Text>
                    )}
                    {datasets.data?.length === 0 && (
                      <Text>
                        No datasets found. Please create a dataset first.
                      </Text>
                    )}
                    <RadioCard.Root
                      variant="outline"
                      colorPalette="blue"
                      value={wizardState.datasetId}
                    >
                      <Grid
                        width="full"
                        templateColumns="repeat(2, 1fr)"
                        gap={3}
                      >
                        {datasets.data?.map((dataset) => (
                          <RadioCard.Item
                            key={dataset.id}
                            value={dataset.id}
                            width="full"
                            minWidth={0}
                            onClick={() => handleDatasetSelect(dataset.id)}
                          >
                            <RadioCard.ItemHiddenInput />
                            <RadioCard.ItemControl
                              cursor="pointer"
                              width="full"
                            >
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
                                    <Text
                                      fontSize="xs"
                                      color="gray.500"
                                      fontWeight="normal"
                                    >
                                      {dataset._count.datasetRecords} entries
                                    </Text>
                                  </VStack>
                                </VStack>
                              </RadioCard.ItemContent>
                              <RadioCard.ItemIndicator />
                            </RadioCard.ItemControl>
                          </RadioCard.Item>
                        ))}
                      </Grid>
                    </RadioCard.Root>
                  </VStack>
                )}

                {wizardState.dataSource === "from_production" && (
                  <VStack width="full" align="start" gap={3}>
                    <Text>Configure import from production settings</Text>
                    <Button
                      colorPalette="blue"
                      onClick={() => handleContinue("from_production")}
                    >
                      Continue with Production Data
                    </Button>
                  </VStack>
                )}

                {wizardState.dataSource === "manual" && (
                  <VStack width="full" align="start" gap={3}>
                    <Text>Configure manual dataset creation</Text>
                    <Button
                      colorPalette="green"
                      onClick={() => handleContinue("manual")}
                    >
                      Continue with Manual Creation
                    </Button>
                  </VStack>
                )}

                {wizardState.dataSource === "upload" && (
                  <VStack width="full" align="start" gap={3}>
                    <Text>Configure CSV upload settings</Text>
                    <Button
                      colorPalette="orange"
                      onClick={() => handleContinue("upload")}
                    >
                      Continue to Upload
                    </Button>
                  </VStack>
                )}
              </Accordion.ItemContent>
            </Accordion.Item>
          </VStack>
        )}
      </Accordion.Root>
    </VStack>
  );
}
