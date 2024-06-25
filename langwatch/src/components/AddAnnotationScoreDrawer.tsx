import {
  Button,
  Divider,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerHeader,
  FormControl,
  FormLabel,
  Grid,
  GridItem,
  HStack,
  Input,
  Select,
  Spacer,
  Text,
  Textarea,
  VStack,
  useToast,
} from "@chakra-ui/react";
import { useForm } from "react-hook-form";

import { DeleteIcon } from "@chakra-ui/icons";
import { useState } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useDrawer } from "./CurrentDrawer";
import { HorizontalFormControl } from "./HorizontalFormControl";

import { AnnotationScoreDataType } from "@prisma/client";

export const AddAnnotationScoreDrawer = () => {
  const { project } = useOrganizationTeamProject();

  const toast = useToast();

  const createAnnotationScore = api.annotationScore.create.useMutation();

  const { closeDrawer } = useDrawer();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
    reset,
  } = useForm({
    defaultValues: {
      name: "",
      dataType: "boolean",
      description: "",
      category: Array(5).fill(""),
      categoryExplanation: Array(5).fill(""),
      dataTypeBoolean: {
        true: "",
        false: "",
      },
    },
  });

  type FormData = {
    name: string;
    description?: string | null;
    category?: string[] | null;
    categoryExplanation?: string[] | null;
    dataTypeBoolean?: { true: string; false: string } | null;
    dataType: string;
  };

  const onSubmit = (data: FormData) => {
    createAnnotationScore.mutate(
      {
        name: data.name,
        dataType: data.dataType as AnnotationScoreDataType,
        description: data.description,
        category: data.category,
        categoryExplanation: data.categoryExplanation,
        projectId: project?.id ?? "",
      },
      {
        onSuccess: (data) => {
          toast({
            title: "Dataset Created",
            description: `Successfully created ${data.name} dataset`,
            status: "success",
            duration: 5000,
            isClosable: true,
            position: "top-right",
          });
          closeDrawer();
          reset();
        },
        onError: (error) => {
          toast({
            title: "Error creating dataset",
            description: error.message,
            status: "error",
            duration: 5000,
            isClosable: true,
            position: "top-right",
          });
        },
      }
    );
  };

  const watchDataType = watch("dataType");

  const CategoryInput = () => {
    const [inputs, setInputs] = useState<string[]>([""]);

    const addInput = () => {
      if (inputs.length < 5) {
        setInputs([...inputs, ""]);
      }
    };
    const removeInput = (index: number) => {
      setValue(`category.${index}`, "");
      setInputs(inputs.filter((_, i) => i !== index));
    };

    return (
      <>
        <VStack spacing={2} mt={4}>
          {inputs.map((input, index) => (
            <VStack key={index} width="full">
              <Grid templateColumns="repeat(3, 1fr)" rowGap={2}>
                <GridItem>
                  <Text>Label</Text>
                </GridItem>
                <GridItem colSpan={2}>
                  <HStack>
                    <Input {...register(`category.${index}`)} />
                    <Button
                      size="md"
                      variant="outline"
                      onClick={() => removeInput(index)}
                      isDisabled={
                        index !== inputs.length - 1 || inputs.length === 1
                      }
                    >
                      <DeleteIcon />
                    </Button>
                  </HStack>
                </GridItem>
                <GridItem>
                  <Text>Explanation</Text>
                </GridItem>
                <GridItem colSpan={2}>
                  <Input
                    fontSize="sm"
                    {...register(`categoryExplanation.${index}`)}
                  />
                </GridItem>
              </Grid>
              <Divider />
            </VStack>
          ))}
        </VStack>
        <Button
          onClick={addInput}
          colorScheme="orange"
          mt={2}
          size="sm"
          disabled={inputs.length >= 5}
        >
          Add Category
        </Button>
      </>
    );
  };

  return (
    <Drawer
      isOpen={true}
      placement="right"
      size={"xl"}
      onClose={closeDrawer}
      onOverlayClick={closeDrawer}
    >
      <DrawerContent>
        <DrawerHeader>
          <HStack>
            <DrawerCloseButton />
          </HStack>
          <HStack>
            <Text paddingTop={5} fontSize="2xl">
              Add Score Metric
            </Text>
          </HStack>
        </DrawerHeader>
        <DrawerBody>
          {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
          <form onSubmit={handleSubmit(onSubmit)}>
            <VStack spacing={4} align="start">
              <HorizontalFormControl
                label="Name"
                helper="Give it a name that makes it easy to identify this score metric"
                isInvalid={!!errors.name}
              >
                <Input {...register("name")} required />
              </HorizontalFormControl>
              <HorizontalFormControl
                label="Description"
                helper="Provide a description of the score metric"
                isInvalid={!!errors.description}
              >
                <Textarea {...register("description")} required />
              </HorizontalFormControl>
              <HorizontalFormControl
                label="Data type"
                helper={
                  watchDataType === "BOOLEAN"
                    ? "Create a simple True or False metric to evaluate the quality of the annotation"
                    : watchDataType === "CATEGORICAL"
                    ? "Select different pre-defined categories for the annotation, add a label and explanation for each category"
                    : watchDataType === "LIKERT"
                    ? "This score metric will be used to evaluate the quality of the annotation using the Likert Scale"
                    : ""
                }
                isInvalid={!!errors.dataType}
              >
                <Select
                  {...register("dataType")}
                  placeholder="Select data type"
                  required
                >
                  <option value={AnnotationScoreDataType.BOOLEAN}>
                    BOOLEAN
                  </option>
                  <option value={AnnotationScoreDataType.CATEGORICAL}>
                    CATEGORICAL
                  </option>
                  <option value={AnnotationScoreDataType.LIKERT}>
                    LIKERT SCALE
                  </option>
                </Select>

                {watchDataType === "BOOLEAN" && (
                  <FormControl mt={4}>
                    <FormLabel>Label</FormLabel>
                    <VStack spacing={2}>
                      <Input readOnly value="True" />
                      <Input readOnly value="False" />
                    </VStack>
                  </FormControl>
                )}
                {watchDataType === "CATEGORICAL" && (
                  <FormControl mt={4}>
                    <CategoryInput />
                  </FormControl>
                )}
                {watchDataType === "LIKERT" && (
                  <FormControl mt={4}>
                    <FormLabel>Scale</FormLabel>
                    <VStack spacing={2}>
                      <Input readOnly value="Strongly Agree" />
                      <Input readOnly value="Agree" />
                      <Input readOnly value="Disagree" />
                      <Input readOnly value="Strongly Disagree" />
                    </VStack>
                  </FormControl>
                )}
              </HorizontalFormControl>

              <HStack width="full">
                <Spacer />
                <Button
                  colorScheme="orange"
                  type="submit"
                  minWidth="fit-content"
                >
                  Add Score Metric
                </Button>
              </HStack>
            </VStack>
          </form>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
};
