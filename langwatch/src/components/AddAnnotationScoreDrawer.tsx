import {
  Button,
  Card,
  CardBody,
  HStack,
  Heading,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Spacer,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tooltip,
  Tr,
  VStack,
  useToast,
  useDisclosure,
  Modal,
  ModalContent,
  ModalHeader,
  ModalOverlay,
  ModalBody,
  ModalCloseButton,
  FormControl,
  FormLabel,
  Input,
  Select,
  Textarea,
  Box,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerHeader,
  Grid,
  GridItem,
  Divider,
} from "@chakra-ui/react";
import type { TriggerAction } from "@prisma/client";
import { MoreVertical, Plus } from "react-feather";
import { useForm, type FieldErrors } from "react-hook-form";

import { DeleteIcon } from "@chakra-ui/icons";
import { Switch } from "@chakra-ui/react";
import { useState } from "react";
import { useFilterParams } from "~/hooks/useFilterParams";
import { useDrawer } from "./CurrentDrawer";
import { HorizontalFormControl } from "./HorizontalFormControl";

export const AddAnnotationScoreDrawer = () => {
  //   const { project, organization, team } = useOrganizationTeamProject();
  //   const { onOpen, onClose, isOpen } = useDisclosure();

  //   const toast = useToast();
  //   const createTrigger = api.trigger.create.useMutation();
  //   const teamSlug = team?.slug;

  //   const teamWithMembers = api.team.getTeamWithMembers.useQuery(
  //     {
  //       slug: teamSlug ?? "",
  //       organizationId: organization?.id ?? "",
  //     },
  //     { enabled: typeof teamSlug === "string" && !!organization?.id }
  //   );

  const { closeDrawer } = useDrawer();

  //   const { filterParams } = useFilterParams();

  const {
    register,
    handleSubmit,
    watch,
    getValues,
    setValue,
    formState: { errors },
    reset,
  } = useForm({
    defaultValues: {
      name: "",
      dataType: "boolean",
      description: "",
      category: ["", "", "", "", ""],
      categoryExplanation: ["", "", "", "", ""],
    },
  });

  const onSubmit = (data) => {
    console.log(data);
    reset();
  };

  const watchDataType = watch("dataType");

  const CategoryInput = () => {
    const [inputs, setInputs] = useState<string[]>([""]);
    console.log(inputs);

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
                  <option value="BOOLEAN">BOOLEAN</option>
                  <option value="CATEGORICAL">CATEGORICAL</option>
                  <option value="LIKERT">LIKERT SCALE</option>
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
              <HorizontalFormControl
                label="Description"
                helper="Provide a description of the score metric"
                isInvalid={!!errors.description}
              >
                <Textarea
                  {...register("description")}
                  placeholder="Provide a description of the score metric"
                  required
                />
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
