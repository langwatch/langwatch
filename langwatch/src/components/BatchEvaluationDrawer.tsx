import {
  Box,
  Button,
  Container,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerHeader,
  FormControl,
  FormErrorMessage,
  FormHelperText,
  HStack,
  Input,
  Radio,
  RadioGroup,
  Stack,
  VStack,
  useToast,
  Text,
  Select,
  Skeleton,
  Alert,
  AlertIcon,
  Card,
  CardBody,
  Heading,
  LinkOverlay,
  Switch,
  TableCaption,
  TableContainer,
  Tbody,
  Td,
  Tfoot,
  Th,
  Thead,
  Table,
  Tr,
  Tooltip,
  Spacer,
} from "@chakra-ui/react";
import { DatabaseSchema } from "@prisma/client";
import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import slugify from "slugify";
import { ChevronRight } from "react-feather";
import { TeamRoleGroup } from "~/server/api/permission";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
} from "~/trace_checks/evaluators.generated";
import type { CheckPreconditions } from "~/trace_checks/types";
import { camelCaseToLowerCase } from "~/utils/stringCasing";
import { RenderCode } from "../../../docs/docs/integration-guides/utils/RenderCode";
import { BatchDatasetProcessing } from "./integration-guides/BatchDatasetProcessing";
import { object } from "zod";

interface BatchEvaluatioProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function BatchEvaluationDrawer(props: BatchEvaluatioProps) {
  const [selectedChecks, setSelectedChecks] = useState<string[]>([]);
  const { project } = useOrganizationTeamProject();
  const [step, setStep] = useState<number>(1);
  const [selectedDataset, setSelectedDataset] = useState<string>("");
  const [selectedGenerations, setSelectedGenerations] =
    useState<string>("one-shot");
  const router = useRouter();

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

  const onSubmit = (e: any) => {
    e.preventDefault();

    console.log(checkError);

    if (checkError) {
      return;
    }
    setStep(2);
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
      isOpen={props.isOpen}
      placement="right"
      size={"xl"}
      onClose={props.onClose}
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
                    <FormControl>
                      <Select
                        onChange={(e) => setSelectedDataset(e.target.value)}
                      >
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
                    </FormControl>
                  </VStack>
                </Container>
              </HStack>
              <HStack align={"start"} gap={12} paddingY={4}>
                <Container padding={0}>
                  <VStack align={"start"} padding={0}>
                    <Text fontWeight={"bold"}>Generations per entry</Text>
                    <Text fontSize={"sm"}>
                      More attempts may reduce variance
                    </Text>
                  </VStack>
                </Container>
                <Container>
                  <VStack align={"start"}>
                    <FormControl>
                      <Select
                        onChange={(e) => setSelectedGenerations(e.target.value)}
                      >
                        <option value={"one-shot"}>One-shot</option>
                      </Select>
                    </FormControl>
                  </VStack>
                </Container>
              </HStack>

              <HStack align={"start"} gap={12} paddingY={4}>
                <VStack align={"start"} padding={0}>
                  <Text fontWeight={"bold"}>Evaluations</Text>
                  <Text fontSize={"sm"}>
                    Select which evaluations to run in batch for this dataset
                  </Text>
                </VStack>
              </HStack>

              <VStack width="full" paddingTop={6} spacing={4}>
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
                          An error has occurred trying to load the check configs
                        </Alert>
                      ) : Object.entries(AVAILABLE_EVALUATORS).length ? (
                        Object.entries(AVAILABLE_EVALUATORS).map(
                          (check, index) => {
                            const description = check[1].description;

                            console.log(check);

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
                        <Alert status="info">
                          <AlertIcon />
                          No checks configured
                        </Alert>
                      )}
                    </Tbody>
                  </Table>
                </TableContainer>
              </VStack>
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
                  generations={selectedGenerations}
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
