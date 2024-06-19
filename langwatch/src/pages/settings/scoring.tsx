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
} from "@chakra-ui/react";
import type { TriggerAction } from "@prisma/client";
import { MoreVertical, Plus } from "react-feather";
import { useForm, type FieldErrors } from "react-hook-form";
import { useDrawer } from "~/components/CurrentDrawer";

import SettingsLayout from "../../components/SettingsLayout";
import { api } from "../../utils/api";
import { DeleteIcon } from "@chakra-ui/icons";
import { Switch } from "@chakra-ui/react";
import { ProjectSelector } from "../../components/DashboardLayout";
import { useState } from "react";

const TagsPage = () => {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const { closeDrawer, openDrawer } = useDrawer();

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
    //reset();
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
        <VStack spacing={2}>
          {inputs.map((input, index) => (
            <VStack key={index} width="full">
              <HStack key={index} width="full">
                <Input {...register(`category.${index}`)} />
                <Button
                  size="md"
                  variant="outline"
                  onClick={() => removeInput(index)}
                  isDisabled={index !== inputs.length - 1}
                >
                  <DeleteIcon />
                </Button>
              </HStack>
              <HStack width="full">
                <Text fontSize="sm">Explanation</Text>
                <Input
                  fontSize="sm"
                  {...register(`categoryExplanation.${index}`)}
                />
              </HStack>
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
          Add Input
        </Button>
      </>
    );
  };

  return (
    <SettingsLayout>
      <VStack
        paddingX={4}
        paddingY={6}
        spacing={6}
        width="full"
        maxWidth="6xl"
        align="start"
      >
        <HStack width="full" marginTop={2}>
          <Heading size="lg" as="h1">
            Annotation Scoring
          </Heading>
          <Spacer />
          <Button
            size="sm"
            colorScheme="orange"
            leftIcon={<Plus size={20} />}
            onClick={() => openDrawer("addAnnotationScore")}
          >
            Add new score metric
          </Button>
        </HStack>
        <Card width="full">
          <CardBody>
            <Text>Tags</Text>
          </CardBody>
        </Card>
      </VStack>
      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Create new score metric</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <form onSubmit={handleSubmit(onSubmit)}>
              <VStack spacing={4} align="start">
                <FormControl>
                  <FormLabel>Name</FormLabel>
                  <Input {...register("name")} />
                </FormControl>
                <FormControl>
                  <FormLabel>Data type</FormLabel>
                  <Select
                    {...register("dataType")}
                    placeholder="Select data type"
                  >
                    <option value="BOOLEAN">BOOLEAN</option>
                    <option value="CATEGORICAL">CATEGORICAL</option>
                    <option value="LIKERT">LIKERT SCALE</option>
                  </Select>
                </FormControl>
                {watchDataType === "BOOLEAN" && (
                  <FormControl>
                    <FormLabel>Label</FormLabel>
                    <VStack spacing={2}>
                      <Input readOnly value="True" />
                      <Input readOnly value="False" />
                    </VStack>
                  </FormControl>
                )}
                {watchDataType === "CATEGORICAL" && (
                  <FormControl>
                    <FormLabel>Categories</FormLabel>
                    <CategoryInput />
                  </FormControl>
                )}
                {watchDataType === "LIKERT" && (
                  <FormControl>
                    <FormLabel>Scale</FormLabel>
                    <VStack spacing={2}>
                      <Input readOnly value="Strongly Agree" />
                      <Input readOnly value="Agree" />
                      <Input readOnly value="Disagree" />
                      <Input readOnly value="Strongly Disagree" />
                    </VStack>
                  </FormControl>
                )}
                <FormControl marginTop={4}>
                  <FormLabel>Description</FormLabel>
                  <Textarea
                    {...register("description")}
                    placeholder="Provide a description of the score metric"
                  />
                </FormControl>
                <HStack width="full">
                  <Spacer />
                  <Button
                    colorScheme="orange"
                    type="submit"
                    minWidth="fit-content"
                  >
                    Add Trigger
                  </Button>
                </HStack>
              </VStack>
            </form>
          </ModalBody>
        </ModalContent>
      </Modal>
    </SettingsLayout>
  );
};

export default TagsPage;
