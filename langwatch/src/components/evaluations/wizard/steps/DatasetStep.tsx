import {
  Accordion,
  Button,
  Grid,
  Heading,
  RadioCard,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useState } from "react";
import {
  Database,
  FilePlus,
  FileText,
  Folder,
  UploadCloud,
} from "react-feather";
import {
  DATA_SOURCE_TYPES,
  useEvaluationWizardStore,
  type State,
} from "~/components/evaluations/wizard/hooks/evaluation-wizard-store/useEvaluationWizardStore";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { StepRadio } from "../components/StepButton";
import { OverflownTextWithTooltip } from "../../../OverflownText";
import type { DatasetColumns } from "../../../../server/datasets/types";
import { StepAccordion } from "../components/StepAccordion";
import { useAnimatedFocusElementById } from "../../../../hooks/useAnimatedFocusElementById";
import { InlineUploadCSVForm } from "~/components/datasets/UploadCSVModal";

export function DatasetStep() {
  const { setWizardState, wizardState, setDatasetId, getDatasetId } =
    useEvaluationWizardStore();
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

  const focusElementById = useAnimatedFocusElementById();

  const handleDatasetSelect = (datasetId: string) => {
    const dataset = datasets.data?.find((d) => d.id === datasetId);
    if (!dataset) {
      return;
    }
    setDatasetId(datasetId, dataset.columnTypes as DatasetColumns);

    focusElementById("js-next-step-button");
  };

  const handleContinue = (
    dataSource: "from_production" | "manual" | "upload"
  ) => {
    setWizardState({
      step: "execution",
      dataSource,
    });
  };

  // Handle CSV upload success
  const handleCSVUploadSuccess = (
    datasetId: string,
    columnTypes: DatasetColumns
  ) => {
    setDatasetId(datasetId, columnTypes);
    setWizardState({
      step: "execution",
    });
  };

  return (
    <VStack width="full" align="start" gap={4}>
      <VStack align="start" paddingTop={6}>
        <Heading as="h2" size="md">
          Datasets
        </Heading>
        <Text>
          {wizardState.task === "real_time"
            ? "Choose some sample data to test the evaluation before setting it up in production"
            : "Choose where your evaluation data will come from"}
        </Text>
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
          <StepAccordion
            value="data-source"
            width="full"
            borderColor="blue.400"
            title="Data Source"
            showTrigger={!!wizardState.dataSource}
          >
            <RadioCard.Root
              variant="outline"
              colorPalette="blue"
              value={wizardState.dataSource}
              onValueChange={(e) =>
                handleDataSourceSelect(
                  e.value as Exclude<
                    State["wizardState"]["dataSource"],
                    undefined
                  >
                )
              }
            >
              <VStack width="full" gap={3} paddingX="1px">
                <StepRadio
                  value="choose"
                  title={DATA_SOURCE_TYPES.choose}
                  description="Select from your previously created datasets"
                  _icon={{ color: "blue.400" }}
                  icon={<Database />}
                  onClick={() => handleDataSourceSelect("choose")}
                />

                <StepRadio
                  value="upload"
                  title={DATA_SOURCE_TYPES.upload}
                  description="Upload your pre-existing dataset from Excel or CSV"
                  _icon={{ color: "blue.400" }}
                  icon={<UploadCloud />}
                  onClick={() => handleDataSourceSelect("upload")}
                />

                <StepRadio
                  value="from_production"
                  title={DATA_SOURCE_TYPES.from_production}
                  description="Import tracing data from production to test the evaluator"
                  _icon={{ color: "blue.400" }}
                  icon={<FileText />}
                  disabled
                  onClick={() => handleDataSourceSelect("from_production")}
                />

                <StepRadio
                  value="manual"
                  title={DATA_SOURCE_TYPES.manual}
                  description="Insert some initial test data manually, use AI to expand it"
                  _icon={{ color: "blue.400" }}
                  icon={<FilePlus />}
                  disabled
                  onClick={() => handleDataSourceSelect("manual")}
                />
              </VStack>
            </RadioCard.Root>
          </StepAccordion>

          {/* Second Accordion - Configuration Options */}
          {wizardState.dataSource && (
            <StepAccordion
              value="configuration"
              width="full"
              borderColor="blue.400"
              title={
                <Text>
                  {wizardState.dataSource === "choose" && "Select Dataset"}
                  {wizardState.dataSource === "from_production" &&
                    "Import from Production"}
                  {wizardState.dataSource === "manual" &&
                    "Create Dataset Manually"}
                  {wizardState.dataSource === "upload" && "Upload CSV"}
                </Text>
              }
            >
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
                    value={getDatasetId()}
                  >
                    <Grid width="full" templateColumns="repeat(2, 1fr)" gap={3}>
                      {datasets.data?.map((dataset) => (
                        <RadioCard.Item
                          key={dataset.id}
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
                <InlineUploadCSVForm
                  onSuccess={({ datasetId, columnTypes }) => {
                    handleCSVUploadSuccess(datasetId, columnTypes);
                  }}
                />
              )}
            </StepAccordion>
          )}
        </VStack>
      </Accordion.Root>
    </VStack>
  );
}
