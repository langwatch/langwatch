import {
  Alert,
  AlertIcon,
  Button,
  Container,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerHeader,
  FormControl,
  FormErrorMessage,
  HStack,
  Link,
  Select,
  Skeleton,
  Spacer,
  Switch,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Table,
  TableContainer,
  Tabs,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tooltip,
  Tr,
  VStack,
} from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useState } from "react";
import { useDrawer } from "~/components/CurrentDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { AVAILABLE_EVALUATORS } from "~/trace_checks/evaluators.generated";
import { api } from "~/utils/api";
import { type Check } from "@prisma/client";
import type { JsonObject } from "@prisma/client/runtime/library";
import { RenderCode } from "~/components/integration-guides/utils/RenderCode";

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
      <Alert status="info">
        <AlertIcon />
        No checks configured, you can add them in the Guardrails and Evaluations
        page&nbsp;
        <Link href={`/${project?.slug}/evaluations`} textDecoration="underline">
          here
        </Link>
      </Alert>
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
    <Drawer
      isOpen={true}
      placement="right"
      size={"xl"}
      onClose={() => {
        setStep(1);
        closeDrawer();
      }}
    >
      <DrawerContent>
        <DrawerHeader>
          <HStack>
            <DrawerCloseButton />
          </HStack>
          <HStack>
            <Text paddingTop={5} fontSize="2xl">
              Batch Evaluation
            </Text>
          </HStack>
        </DrawerHeader>
        <DrawerBody>
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
                      <FormControl isInvalid={selectDBError}>
                        <Select
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
                        </Select>
                        <FormErrorMessage>
                          Please select dataset
                        </FormErrorMessage>
                      </FormControl>
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
                <Tabs>
                  <TabList>
                    <Tab>Output Comparison</Tab>
                    <Tab>Evaluations</Tab>
                    <Tab>Guardrails</Tab>
                  </TabList>

                  <TabPanels>
                    <TabPanel padding={0}>
                      <HStack>
                        <TableContainer>
                          <Table
                            variant="simple"
                            borderWidth={1}
                            borderColor={"gray.200"}
                          >
                            <Thead backgroundColor={"gray.200"}>
                              <Tr>
                                <Th></Th>
                                <Th>NAME</Th>
                                <Th>DESCRIPTION</Th>
                                <Th>REQUIRED</Th>
                                <Th></Th>
                              </Tr>
                            </Thead>
                            <Tbody>
                              {checks.isLoading ? (
                                <Tr>
                                  <Td>
                                    <Skeleton width="full" height="20px" />
                                  </Td>
                                  <Td>
                                    <Skeleton width="full" height="20px" />
                                  </Td>
                                  <Td>
                                    <Skeleton width="full" height="20px" />
                                  </Td>
                                  <Td>
                                    <Skeleton width="full" height="20px" />
                                  </Td>
                                </Tr>
                              ) : checks.isError ? (
                                <Alert status="error">
                                  <AlertIcon />
                                  An error has occurred trying to load the check
                                  configs
                                </Alert>
                              ) : Object.entries(AVAILABLE_EVALUATORS)
                                  .length ? (
                                Object.entries(AVAILABLE_EVALUATORS).map(
                                  (check, index) => {
                                    const description = check[1].description;

                                    console.log(check);

                                    if (check[1].category != "similarity") {
                                      return null;
                                    }

                                    return (
                                      <Tr key={index}>
                                        <Td>
                                          {" "}
                                          <Switch
                                            size="lg"
                                            isChecked={selectedChecks.includes(
                                              check[0]
                                            )}
                                            position="relative"
                                            zIndex={1}
                                            onChange={() =>
                                              handleSwitchChange(check[0])
                                            }
                                            variant="darkerTrack"
                                          />
                                        </Td>
                                        <Td> {check[1].name}</Td>
                                        <Td>
                                          <Tooltip label={description}>
                                            <Text
                                              noOfLines={2}
                                              display="block"
                                              maxWidth={230}
                                            >
                                              {description}
                                            </Text>
                                          </Tooltip>
                                        </Td>
                                        <Td>
                                          {check[1].requiredFields
                                            ? check[1].requiredFields.join(", ")
                                            : ""}
                                        </Td>
                                        <Td></Td>
                                      </Tr>
                                    );
                                  }
                                )
                              ) : (
                                <Tr>
                                  <Td colSpan={4}>
                                    <NotFound />
                                  </Td>
                                </Tr>
                              )}
                            </Tbody>
                          </Table>
                        </TableContainer>
                      </HStack>
                    </TabPanel>
                    <TabPanel padding={0}>
                      <TableContainer>
                        <Table
                          variant="simple"
                          borderWidth={1}
                          borderColor={"gray.200"}
                        >
                          <Thead backgroundColor={"gray.200"}>
                            <Tr>
                              <Th></Th>
                              <Th>NAME</Th>
                              <Th>DESCRIPTION</Th>
                              <Th>REQUIRED</Th>
                              <Th></Th>
                            </Tr>
                          </Thead>
                          <Tbody>
                            {checks.isLoading ? (
                              <Tr>
                                <Td>
                                  <Skeleton width="full" height="20px" />
                                </Td>
                                <Td>
                                  <Skeleton width="full" height="20px" />
                                </Td>
                                <Td>
                                  <Skeleton width="full" height="20px" />
                                </Td>
                                <Td>
                                  <Skeleton width="full" height="20px" />
                                </Td>
                              </Tr>
                            ) : checks.isError ? (
                              <Alert status="error">
                                <AlertIcon />
                                An error has occurred trying to load the check
                                configs
                              </Alert>
                            ) : checksData.length ? (
                              checksData.map((check, index) => {
                                if (check.isGuardrail) {
                                  return null;
                                }
                                return (
                                  <Tr key={index}>
                                    <Td>
                                      {" "}
                                      <Switch
                                        size="lg"
                                        isChecked={selectedChecks.includes(
                                          check.slug
                                        )}
                                        position="relative"
                                        zIndex={1}
                                        onChange={() =>
                                          handleSwitchChange(check.slug)
                                        }
                                        variant="darkerTrack"
                                      />
                                    </Td>
                                    <Td> {check.name}</Td>
                                    <Td>
                                      <Tooltip
                                        label={
                                          (
                                            (check.parameters as JsonObject)
                                              ?.prompt ?? check.description
                                          )?.toString() ?? ""
                                        }
                                      >
                                        <Text
                                          noOfLines={2}
                                          display="block"
                                          maxWidth={230}
                                        >
                                          {(
                                            (check.parameters as JsonObject)
                                              ?.prompt ?? check.description
                                          )?.toString() ?? ""}
                                        </Text>
                                      </Tooltip>
                                    </Td>
                                    <Td>
                                      {check.requiredFields
                                        ? check.requiredFields.join(", ")
                                        : ""}
                                    </Td>
                                    <Td></Td>
                                  </Tr>
                                );
                              })
                            ) : (
                              <Tr>
                                <Td colSpan={4}>
                                  <NotFound />
                                </Td>
                              </Tr>
                            )}
                          </Tbody>
                        </Table>
                      </TableContainer>
                    </TabPanel>
                    <TabPanel padding={0}>
                      <TableContainer>
                        <Table
                          variant="simple"
                          borderWidth={1}
                          borderColor={"gray.200"}
                        >
                          <Thead backgroundColor={"gray.200"}>
                            <Tr>
                              <Th></Th>
                              <Th>NAME</Th>
                              <Th>DESCRIPTION</Th>
                              <Th>REQUIRED</Th>
                              <Th></Th>
                            </Tr>
                          </Thead>
                          <Tbody>
                            {checks.isLoading ? (
                              <Tr>
                                <Td>
                                  <Skeleton width="full" height="20px" />
                                </Td>
                                <Td>
                                  <Skeleton width="full" height="20px" />
                                </Td>
                                <Td>
                                  <Skeleton width="full" height="20px" />
                                </Td>
                                <Td>
                                  <Skeleton width="full" height="20px" />
                                </Td>
                              </Tr>
                            ) : checks.isError ? (
                              <Alert status="error">
                                <AlertIcon />
                                An error has occurred trying to load the check
                                configs
                              </Alert>
                            ) : checksData.length ? (
                              checksData.map((check, index) => {
                                if (!check.isGuardrail) {
                                  return null;
                                }
                                return (
                                  <Tr key={index}>
                                    <Td>
                                      {" "}
                                      <Switch
                                        size="lg"
                                        isChecked={selectedChecks.includes(
                                          check.slug
                                        )}
                                        position="relative"
                                        zIndex={1}
                                        onChange={() =>
                                          handleSwitchChange(check.slug)
                                        }
                                        variant="darkerTrack"
                                      />
                                    </Td>
                                    <Td> {check.name}</Td>
                                    <Td>
                                      <Tooltip
                                        label={
                                          (
                                            (check.parameters as JsonObject)
                                              ?.prompt ?? check.description
                                          )?.toString() ?? ""
                                        }
                                      >
                                        <Text
                                          noOfLines={2}
                                          display="block"
                                          maxWidth={230}
                                        >
                                          {(
                                            (check.parameters as JsonObject)
                                              ?.prompt ?? check.description
                                          )?.toString() ?? ""}
                                        </Text>
                                      </Tooltip>
                                    </Td>
                                    <Td>
                                      {check.requiredFields
                                        ? check.requiredFields.join(", ")
                                        : ""}
                                    </Td>
                                    <Td></Td>
                                  </Tr>
                                );
                              })
                            ) : (
                              <Tr>
                                <Td colSpan={4}>
                                  <NotFound />
                                </Td>
                              </Tr>
                            )}
                          </Tbody>
                        </Table>
                      </TableContainer>
                    </TabPanel>
                  </TabPanels>
                </Tabs>
              </HStack>

              <VStack width="full" paddingTop={6} spacing={4}></VStack>
              <HStack gap={12} paddingY={8}>
                <Spacer />
                {checkError ? (
                  <Text color="red.500">
                    Please select at least one evaluation
                  </Text>
                ) : (
                  <Spacer />
                )}

                <Button colorScheme="blue" type="submit" minWidth="fit-content">
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
                  colorScheme="blue"
                  type="submit"
                  minWidth="fit-content"
                  onClick={() => setStep(1)}
                >
                  Back
                </Button>
              </HStack>
            </VStack>
          ) : null}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
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
    # generate messages for entry.input using your LLM
    # input_data = entry.get("input")
    # Assuming entry contains an "input" field

    # Process the input data using your LLM and generate a response
    # response = f"Generated response for input: {input_data}"
    # print(response)
    # return {"output": response}
    return {}
            
            
    # Instantiate the BatchEvaluation object
evaluation = BatchEvaluation(
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
