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
} from "@chakra-ui/react";
import { DatabaseSchema } from "@prisma/client";
import { useState, useEffect } from "react";
import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import slugify from "slugify";

interface BatchEvaluatioProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function BatchEvaluationDrawer(props: BatchEvaluatioProps) {
  const [schemaValue, setSchemaValue] = useState<string>(
    DatabaseSchema.LLM_CHAT_CALL
  );
  const [dataSetName, setDataSetName] = useState<string>("");
  const [slug, setSlug] = useState<string>("");
  const [hasError, setHasError] = useState<boolean>(false);
  const { project } = useOrganizationTeamProject();

  const datasets = api.dataset.getAll.useQuery(
    { projectId: project?.id ?? "" },
    {
      enabled: !!project,
    }
  );

  const toast = useToast();

  const createDataset = api.dataset.create.useMutation();

  const onSubmit = (e: any) => {
    e.preventDefault();
    createDataset.mutate(
      {
        projectId: project?.id ?? "",
        name: dataSetName,
        schema: schemaValue,
      },
      {
        onSuccess: () => {
          props.onSuccess();
          setSlug("");

          toast({
            title: "Dataset Created",
            description: `You have successfully created the dataset ${dataSetName}`,

            status: "success",
            duration: 5000,
            isClosable: true,
            position: "top-right",
          });
        },
      }
    );
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    createDataset.reset();
    setHasError(false);
    setDataSetName(e.target.value);
    setSlug(slugify(e.target.value || "", { lower: true, strict: true }));
  };

  useEffect(() => {
    if (createDataset.error) {
      setHasError(true);
    }
  }, [createDataset.error]);

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
                  <FormControl isInvalid={hasError}>
                    <Select required>
                      <option value={""}>Select Dataset</option>
                      {datasets.data
                        ? datasets.data?.map((dataset, index) => (
                            <option key={index} value={dataset.id}>
                              {dataset.name}
                            </option>
                          ))
                        : null}
                    </Select>
                    <FormErrorMessage>
                      {createDataset.error?.message}
                    </FormErrorMessage>
                  </FormControl>
                </VStack>
              </Container>
            </HStack>
            <HStack align={"start"} gap={12} paddingY={4}>
              <Container padding={0}>
                <VStack align={"start"} padding={0}>
                  <Text fontWeight={"bold"}>Generations per entry</Text>
                  <Text fontSize={"sm"}>
                    More attempts may reduce variance{" "}
                  </Text>
                </VStack>
              </Container>
              <Container>
                <VStack align={"start"}>
                  <FormControl isInvalid={hasError}>
                    <Select required>
                      <Select required>
                        <option value={""}>Select amount</option>
                        <option value={""}>One-shot</option>
                      </Select>
                    </Select>
                    <FormErrorMessage>
                      {createDataset.error?.message}
                    </FormErrorMessage>
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

            <Button colorScheme="blue" type="submit" minWidth="fit-content">
              Create Dataset
            </Button>
          </form>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
