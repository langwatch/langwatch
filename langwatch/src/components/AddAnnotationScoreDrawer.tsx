import {
  Button,
  Checkbox,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerHeader,
  FormControl,
  FormHelperText,
  HStack,
  IconButton,
  Input,
  Radio,
  RadioGroup,
  Select,
  Spacer,
  Text,
  Textarea,
  VStack,
  useToast,
} from "@chakra-ui/react";
import { useForm } from "react-hook-form";

import { AddIcon } from "@chakra-ui/icons";
import { useState } from "react";
import { X } from "react-feather";
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
    },
  });

  type FormData = {
    name: string;
    description?: string | null;
    category?: string[] | null;
    categoryExplanation?: string[] | null;
    dataType: string;
    options?: string[] | null;
    checkbox?: string[] | null;
    defaultRadioOption?: string | null;
    defaultCheckboxOption?: string[] | null;
  };

  const [radioCheckboxOptions, setRadioCheckboxOptions] = useState<string[]>([
    "",
  ]);
  const [defaultRadioOption, setDefaultRadioOption] = useState<string>("");
  const [defaultCheckboxOption, setDefaultCheckboxOption] = useState<string[]>(
    []
  );

  const onSubmit = (data: FormData) => {
    if (
      radioCheckboxOptions.length === 0 ||
      radioCheckboxOptions.every((opt) => !opt.trim())
    ) {
      toast({
        title: "Error creating annotation score",
        description: "Please add at least one option",
        status: "error",
        duration: 5000,
        isClosable: true,
        position: "top-right",
      });
      return;
    }

    const trimmedRadioCheckboxOptions = radioCheckboxOptions.filter(
      (opt) => opt.trim() !== ""
    );

    const normalizedOptions = trimmedRadioCheckboxOptions.map((opt) =>
      opt.toLowerCase()
    );
    if (normalizedOptions.length !== new Set(normalizedOptions).size) {
      toast({
        title: "Error creating annotation score",
        description: "Duplicate options are not allowed (case-insensitive)",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
      return;
    }

    createAnnotationScore.mutate(
      {
        name: data.name,
        dataType: data.dataType as AnnotationScoreDataType,
        description: data.description,
        category: data.category,
        categoryExplanation: data.categoryExplanation,
        projectId: project?.id ?? "",
        options: data.options,
        radioCheckboxOptions: trimmedRadioCheckboxOptions,
        defaultRadioOption: defaultRadioOption,
        defaultCheckboxOption: defaultCheckboxOption,
      },
      {
        onSuccess: (data) => {
          toast({
            title: "Annotation Score Created",
            description: `Successfully created ${data.name} annotation score`,
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
            title: "Error creating annotation score",
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
                label="Score Type"
                helper={
                  watchDataType === "OPTION"
                    ? "Single selection from multiple options"
                    : watchDataType === "CHECKBOX"
                    ? "Allow multiple selections with checkboxes"
                    : "Select the score type for the score metric"
                }
                isInvalid={!!errors.dataType}
              >
                <Select
                  {...register("dataType")}
                  placeholder="Select score type"
                  required
                >
                  <option value={AnnotationScoreDataType.OPTION}>
                    Multiple choice
                  </option>
                  <option value={AnnotationScoreDataType.CHECKBOX}>
                    Checkboxes
                  </option>
                </Select>

                {watchDataType === "OPTION" && (
                  <FormControl mt={4}>
                    <VStack align="start" width="full" spacing={2}>
                      <RadioGroup
                        verticalAlign="start"
                        width="full"
                        defaultValue={defaultRadioOption}
                        value={defaultRadioOption}
                      >
                        <VStack align="start" width="full" spacing={2}>
                          {radioCheckboxOptions.map((option, index) => (
                            <HStack key={index} spacing={2} width="full">
                              <Radio
                                value={option}
                                isDisabled={!option.trim()}
                                isChecked={
                                  defaultRadioOption === option &&
                                  defaultRadioOption !== ""
                                }
                                onChange={(e) => {
                                  setDefaultRadioOption(e.target.value);
                                }}
                                onClick={() => {
                                  if (defaultRadioOption === option) {
                                    setTimeout(() => {
                                      setDefaultRadioOption("");
                                    }, 100);
                                  }
                                }}
                              ></Radio>
                              <Input
                                placeholder="value"
                                value={option}
                                onChange={(e) => {
                                  if (defaultRadioOption === option) {
                                    setDefaultRadioOption("");
                                  }
                                  const newOptions = [...radioCheckboxOptions];
                                  newOptions[index] = e.target.value;
                                  setRadioCheckboxOptions(newOptions);
                                }}
                              />
                              <IconButton
                                aria-label="Remove option"
                                icon={<X />}
                                onClick={() => {
                                  const newOptions =
                                    radioCheckboxOptions.filter(
                                      (_, i) => i !== index
                                    );
                                  setRadioCheckboxOptions(newOptions);
                                }}
                                isDisabled={radioCheckboxOptions.length === 1}
                              />
                            </HStack>
                          ))}
                        </VStack>
                      </RadioGroup>

                      <Button
                        leftIcon={<AddIcon />}
                        onClick={() =>
                          setRadioCheckboxOptions([...radioCheckboxOptions, ""])
                        }
                        size="sm"
                        colorScheme="orange"
                      >
                        Add Option
                      </Button>
                      {defaultRadioOption !== "" && (
                        <FormHelperText>
                          <HStack>
                            <Text>Default Option: {defaultRadioOption} </Text>
                          </HStack>
                        </FormHelperText>
                      )}
                    </VStack>
                  </FormControl>
                )}
                {watchDataType === "CHECKBOX" && (
                  <FormControl mt={4}>
                    <VStack align="start" width="full">
                      {radioCheckboxOptions.map((option, index) => (
                        <HStack key={index} spacing={2} width="full">
                          <Checkbox
                            value={option}
                            isDisabled={!option.trim()}
                            onChange={(e) => {
                              if (defaultCheckboxOption.includes(option)) {
                                setTimeout(() => {
                                  setDefaultCheckboxOption(
                                    defaultCheckboxOption.filter(
                                      (opt) => opt !== option
                                    )
                                  );
                                }, 100);
                              } else {
                                setDefaultCheckboxOption([
                                  ...defaultCheckboxOption,
                                  option,
                                ]);
                              }
                            }}
                          ></Checkbox>
                          <Input
                            placeholder="value"
                            value={option}
                            onChange={(e) => {
                              const newOptions = [...radioCheckboxOptions];
                              newOptions[index] = e.target.value;
                              setRadioCheckboxOptions(newOptions);
                            }}
                          />
                          <IconButton
                            aria-label="Remove option"
                            icon={<X />}
                            onClick={() => {
                              const newOptions = radioCheckboxOptions.filter(
                                (_, i) => i !== index
                              );
                              setRadioCheckboxOptions(newOptions);
                            }}
                            isDisabled={radioCheckboxOptions.length === 1}
                          />
                        </HStack>
                      ))}
                      <Button
                        leftIcon={<AddIcon />}
                        onClick={() =>
                          setRadioCheckboxOptions([...radioCheckboxOptions, ""])
                        }
                        size="sm"
                        colorScheme="orange"
                      >
                        Add Option
                      </Button>
                      {defaultCheckboxOption.length > 0 && (
                        <FormHelperText>
                          <HStack>
                            <Text>
                              Default Options:{" "}
                              {defaultCheckboxOption.join(", ")}
                            </Text>
                          </HStack>
                        </FormHelperText>
                      )}
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
