import {
  Alert,
  Button,
  Container,
  Field,
  HStack,
  NativeSelect,
  Skeleton,
  Spacer,
  Table,
  Tabs,
  Text,
  VStack
} from "@chakra-ui/react";
import { EvaluationExecutionMode, type Check } from "@prisma/client";
import type { JsonObject } from "@prisma/client/runtime/library";
import { useRouter } from "next/router";
import { useState } from "react";
import { RenderCode } from "~/components/code/RenderCode";
import { useDrawer } from "~/components/CurrentDrawer";
import { Drawer } from "~/components/ui/drawer";
import { Link } from "~/components/ui/link";
import { Switch } from "~/components/ui/switch";
import { Tooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { AVAILABLE_EVALUATORS } from "~/server/evaluations/evaluators.generated";
import { api } from "~/utils/api";

interface BatchEvaluatioProps {
  datasetSlug?: string | undefined;
  selectDataset?: boolean;
}

export function BatchEvaluationDrawer(props: BatchEvaluatioProps) {
  const [selectedChecks, setSelectedChecks] = useState<string[]>([]);
  const { project } = useOrganizationTeamProject();
  const [step, setStep] = useState<number>(1);
  const [selectedDataset, setSelectedDataset] = useState<string>(
    props.datasetSlug ?? ""
  );
  const [selectDBError, setSelectDBError] = useState<boolean>(false);

  const router = useRouter();
  const { closeDrawer } = useDrawer();

  const checkError = selectedChecks.length === 0;

  const datasetId = router.query.id as string;

  const checks = api.checks.getAllForProject.useQuery(
    {
      projectId: project?.id ?? "",
    },
    { enabled: !!project }
  );

  const datasets = api.dataset.getAll.useQuery(
    { projectId: project?.id ?? "" },
    {
      enabled: !!project,
    }
  );

  const evaluations = Object.entries(AVAILABLE_EVALUATORS);

  type ExtendedCheck = Check & {
    description?: string;
    requiredFields?: any[];
  };

  const checksData: ExtendedCheck[] = [...(checks.data ?? [])];

  if (checksData) {
    checksData.forEach((check, index: number) => {
      const checkType = check.checkType;
      const evaluation = evaluations.find(
        (evaluation) => evaluation[0] === checkType
      );
      if (evaluation) {
        // @ts-ignore: Unreachable code error
        checksData[index].description = evaluation[1]?.description ?? "";
        // @ts-ignore: Unreachable code error
        checksData[index].requiredFields = evaluation[1]?.requiredFields ?? [];
      }
    });
  }

  const onSubmit = (e: any) => {
    e.preventDefault();
    if (props.selectDataset && selectedDataset === "") {
      setSelectDBError(true);
      return;
    }

    if (checkError) {
      return;
    }
    setStep(2);
  };

  const NotFound = () => {
    return (
      <Alert.Root borderStartWidth="4px" borderStartColor="colorPalette.solid">
        <Alert.Indicator />
        <Alert.Content>
          No checks configured, you can add them in the Guardrails and Evaluations
          page&nbsp;
          <Link href={`/${project?.slug}/evaluations`} isExternal>
            here
          </Link>
        </Alert.Content>
      </Alert.Root>
    );
  };

  const handleSwitchChange = (checkType: string) => {
    setSelectedChecks((prev) => {
      if (prev.includes(checkType)) {
        return prev.filter((v) => v !== checkType);
      }
      return [...prev, checkType];
    });
  };

  return (
    <Drawer.Root open={true} placement="end">
      <Drawer.Backdrop />
      <Drawer.Content>
        <Drawer.CloseTrigger
          onClick={() => {
            setStep(1);
            closeDrawer();
          }}
        />
        <Drawer.Header>
          <HStack>
            <Text paddingTop={5} fontSize="2xl">
              Batch Evaluation
            </Text>
          </HStack>
        </Drawer.Header>
        <Drawer.Body>
          {step === 1 ? (
            <form onSubmit={onSubmit}>
              {props.selectDataset ? (
                <HStack align={"start"} gap={12} paddingBottom={4}>
                  <Container padding={0}>
                    <VStack align={"start"} padding={0}>
                      <Text fontWeight={"bold"}>Dataset</Text>
                      <Text fontSize={"sm"}>
                        Select the dataset to run the batch evaluation on
                      </Text>
                    </VStack>
                  </Container>
                  <Container>
                    <VStack align={"start"}>
                      <Field.Root invalid={selectDBError}>
                        <NativeSelect.Root>
                          <NativeSelect.Field
                            onChange={(e) => {
                              setSelectedDataset(e.target.value);
                              setSelectDBError(false);
                            }}
                          >
                            <option value={""}>Select a dataset</option>
                            {datasets.data
                              ? datasets.data?.map((dataset, index) => (
                                  <option
                                    key={index}
                                    value={dataset.slug}
                                    selected={datasetId === dataset.id}
                                  >
                                    {dataset.name}
                                  </option>
                                ))
                              : null}
                          </NativeSelect.Field>
                          <NativeSelect.Indicator />
                        </NativeSelect.Root>
                        <Field.ErrorText>Please select dataset</Field.ErrorText>
                      </Field.Root>
                    </VStack>
                  </Container>
                </HStack>
              ) : null}

              <HStack align={"start"} gap={12} paddingY={4}>
                <VStack align={"start"} padding={0}>
                  <Text fontWeight={"bold"}>Evaluations</Text>
                  <Text fontSize={"sm"}>
                    Select which evaluations to run in batch for this dataset
                  </Text>
                </VStack>
              </HStack>

              <HStack align={"start"} gap={12}>
                <Tabs.Root defaultValue="evaluations">
                  <Tabs.List>
                    {/* <Tabs.Trigger value="output-comparison">Output Comparison</Tabs.Trigger> */}
                    <Tabs.Trigger value="evaluations">Evaluations</Tabs.Trigger>
                    <Tabs.Trigger value="guardrails">Guardrails</Tabs.Trigger>
                    <Tabs.Indicator />
                  </Tabs.List>

                  <Tabs.Content value="evaluations" padding={0}>
                    <Table.Root
                      variant="line"
                      borderWidth={1}
                      borderColor={"gray.200"}
                    >
                      <Table.Header backgroundColor={"gray.200"}>
                        <Table.Row>
                          <Table.ColumnHeader></Table.ColumnHeader>
                          <Table.ColumnHeader>NAME</Table.ColumnHeader>
                          <Table.ColumnHeader>DESCRIPTION</Table.ColumnHeader>
                          <Table.ColumnHeader>REQUIRED</Table.ColumnHeader>
                          <Table.ColumnHeader></Table.ColumnHeader>
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {checks.isLoading ? (
                          <Table.Row>
                            <Table.Cell>
                              <Skeleton width="full" height="20px" />
                            </Table.Cell>
                            <Table.Cell>
                              <Skeleton width="full" height="20px" />
                            </Table.Cell>
                            <Table.Cell>
                              <Skeleton width="full" height="20px" />
                            </Table.Cell>
                            <Table.Cell>
                              <Skeleton width="full" height="20px" />
                            </Table.Cell>
                          </Table.Row>
                        ) : checks.isError ? (
                          <Table.Row>
                            <Table.Cell colSpan={4}>
                              <Alert.Root
                                borderStartWidth="4px"
                                borderStartColor="colorPalette.solid"
                                colorPalette="red"
                              >
                                <Alert.Indicator />
                                <Alert.Content>
                                  An error has occurred trying to load the check
                                  configs
                                </Alert.Content>
                              </Alert.Root>
                            </Table.Cell>
                          </Table.Row>
                        ) : checksData.length ? (
                          checksData.map((check, index) => {
                            if (
                              check.executionMode ===
                              EvaluationExecutionMode.AS_GUARDRAIL
                            ) {
                              return null;
                            }
                            return (
                              <Table.Row key={index}>
                                <Table.Cell>
                                  <Switch
                                    size="lg"
                                    checked={selectedChecks.includes(
                                      check.slug
                                    )}
                                    position="relative"
                                    zIndex={1}
                                    onCheckedChange={() =>
                                      handleSwitchChange(check.slug)
                                    }
                                    // @ts-ignore
                                    variant="darkerTrack"
                                  />
                                </Table.Cell>
                                <Table.Cell>{check.name}</Table.Cell>
                                <Table.Cell>
                                  <Tooltip
                                    content={
                                      (
                                        (check.parameters as JsonObject)
                                          ?.prompt ?? check.description
                                      )?.toString() ?? ""
                                    }
                                    positioning={{ placement: "top" }}
                                    showArrow
                                  >
                                    <Text
                                      lineClamp={2}
                                      display="block"
                                      maxWidth={230}
                                    >
                                      {(
                                        (check.parameters as JsonObject)
                                          ?.prompt ?? check.description
                                      )?.toString() ?? ""}
                                    </Text>
                                  </Tooltip>
                                </Table.Cell>
                                <Table.Cell>
                                  {check.requiredFields
                                    ? check.requiredFields.join(", ")
                                    : ""}
                                </Table.Cell>
                                <Table.Cell></Table.Cell>
                              </Table.Row>
                            );
                          })
                        ) : (
                          <Table.Row>
                            <Table.Cell colSpan={4}>
                              <NotFound />
                            </Table.Cell>
                          </Table.Row>
                        )}
                      </Table.Body>
                    </Table.Root>
                  </Tabs.Content>

                  <Tabs.Content value="guardrails" padding={0}>
                    <Table.Root
                      variant="line"
                      borderWidth={1}
                      borderColor={"gray.200"}
                    >
                      <Table.Header backgroundColor={"gray.200"}>
                        <Table.Row>
                          <Table.ColumnHeader></Table.ColumnHeader>
                          <Table.ColumnHeader>NAME</Table.ColumnHeader>
                          <Table.ColumnHeader>DESCRIPTION</Table.ColumnHeader>
                          <Table.ColumnHeader>REQUIRED</Table.ColumnHeader>
                          <Table.ColumnHeader></Table.ColumnHeader>
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {checks.isLoading ? (
                          <Table.Row>
                            <Table.Cell>
                              <Skeleton width="full" height="20px" />
                            </Table.Cell>
                            <Table.Cell>
                              <Skeleton width="full" height="20px" />
                            </Table.Cell>
                            <Table.Cell>
                              <Skeleton width="full" height="20px" />
                            </Table.Cell>
                            <Table.Cell>
                              <Skeleton width="full" height="20px" />
                            </Table.Cell>
                          </Table.Row>
                        ) : checks.isError ? (
                          <Table.Row>
                            <Table.Cell colSpan={4}>
                              <Alert.Root
                                borderStartWidth="4px"
                                borderStartColor="colorPalette.solid"
                                colorPalette="red"
                              >
                                <Alert.Indicator />
                                <Alert.Content>
                                  An error has occurred trying to load the check
                                  configs
                                </Alert.Content>
                              </Alert.Root>
                            </Table.Cell>
                          </Table.Row>
                        ) : checksData.length ? (
                          checksData.map((check, index) => {
                            if (
                              check.executionMode !==
                              EvaluationExecutionMode.AS_GUARDRAIL
                            ) {
                              return null;
                            }
                            return (
                              <Table.Row key={index}>
                                <Table.Cell>
                                  <Switch
                                    size="lg"
                                    checked={selectedChecks.includes(
                                      check.slug
                                    )}
                                    position="relative"
                                    zIndex={1}
                                    onCheckedChange={() =>
                                      handleSwitchChange(check.slug)
                                    }
                                    // @ts-ignore
                                    variant="darkerTrack"
                                  />
                                </Table.Cell>
                                <Table.Cell>{check.name}</Table.Cell>
                                <Table.Cell>
                                  <Tooltip
                                    content={
                                      (
                                        (check.parameters as JsonObject)
                                          ?.prompt ?? check.description
                                      )?.toString() ?? ""
                                    }
                                    positioning={{ placement: "top" }}
                                    showArrow
                                  >
                                    <Text
                                      lineClamp={2}
                                      display="block"
                                      maxWidth={230}
                                    >
                                      {(
                                        (check.parameters as JsonObject)
                                          ?.prompt ?? check.description
                                      )?.toString() ?? ""}
                                    </Text>
                                  </Tooltip>
                                </Table.Cell>
                                <Table.Cell>
                                  {check.requiredFields
                                    ? check.requiredFields.join(", ")
                                    : ""}
                                </Table.Cell>
                                <Table.Cell></Table.Cell>
                              </Table.Row>
                            );
                          })
                        ) : (
                          <Table.Row>
                            <Table.Cell colSpan={4}>
                              <NotFound />
                            </Table.Cell>
                          </Table.Row>
                        )}
                      </Table.Body>
                    </Table.Root>
                  </Tabs.Content>
                </Tabs.Root>
              </HStack>

              <VStack width="full" paddingTop={6} gap={4}></VStack>
              <HStack gap={12} paddingY={8}>
                <Spacer />
                {checkError ? (
                  <Text color="red.500">
                    Please select at least one evaluation
                  </Text>
                ) : (
                  <Spacer />
                )}

                <Button
                  colorPalette="blue"
                  type="submit"
                  minWidth="fit-content"
                >
                  Next step
                </Button>
              </HStack>
            </form>
          ) : null}
          {step === 2 ? (
            <VStack align={"start"} width={"full"}>
              <div className="markdown">
                <BatchDatasetProcessing
                  checks={selectedChecks}
                  dataset={selectedDataset}
                />
              </div>
              <HStack align={"start"} gap={12} paddingY={4} width={"full"}>
                <Spacer />
                <Button
                  colorPalette="blue"
                  type="submit"
                  minWidth="fit-content"
                  onClick={() => setStep(1)}
                >
                  Back
                </Button>
              </HStack>
            </VStack>
          ) : null}
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}

export const BatchDatasetProcessing = ({
  apiKey,
  checks,
  dataset,
}: {
  apiKey?: string;
  checks: string[];
  dataset: string;
}) => {
  return (
    <div>
      <h3>Installation:</h3>
      <RenderCode code={`pip install langwatch`} language="bash" />
      <h3>Configuration:</h3>
      <p>Make sure your local environment is set up</p>
      <RenderCode
        code={`export LANGWATCH_API_KEY='${apiKey ?? "your_api_key_here"}'`}
        language="bash"
      />
      <h3>Usage:</h3>
      <p>
        Copy the code below to run locally, implement the callback function with
        a call to your actual pipeline
      </p>
      <RenderCode
        code={`from langwatch.batch_evaluation import BatchEvaluation, DatasetEntry

def callback(entry: DatasetEntry):
    # generate messages for entry["input"] using your LLM
    # input_data = entry["input"]
    # Assuming the dataset contains an "input" column

    # Process the input data using your LLM and generate a response
    # response = f"Generated response for input: {input_data}"
    # print(response)
    # return {"output": response}
    return {}


# Instantiate the BatchEvaluation object
evaluation = BatchEvaluation(
    experiment="My Experiment",
    dataset="${dataset}",
    evaluations=${JSON.stringify(checks)},
    callback=callback,
)

# Run the evaluation
results = evaluation.run()`}
        language="python"
      />
    </div>
  );
};
