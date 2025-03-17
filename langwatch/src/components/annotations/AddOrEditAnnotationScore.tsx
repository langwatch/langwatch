import {
  Box,
  Button,
  Field,
  HStack,
  IconButton,
  Input,
  NativeSelect,
  Spacer,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { useForm } from "react-hook-form";

import { useEffect, useState } from "react";
import { Plus, X } from "react-feather";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

import { AnnotationScoreDataType } from "@prisma/client";
import { FullWidthFormControl } from "../FullWidthFormControl";
import { Radio, RadioGroup } from "../ui/radio";
import { toaster } from "../ui/toaster";

import { Checkbox } from "../ui/checkbox";

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

export const AddOrEditAnnotationScore = ({
  onClose,
  annotationScoreId,
}: {
  onClose: () => void,
  annotationScoreId: string | undefined,
}) => {
  const { project } = useOrganizationTeamProject();
  const upsertAnnotationScore = api.annotationScore.upsert.useMutation();
  const existingAnnotationScore = api.annotationScore.getById.useQuery({
    projectId: project?.id ?? "",
    scoreId: annotationScoreId ?? "",
  }, { enabled: !!annotationScoreId && !!project?.id });

  const queryClient = api.useContext();

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
    reset,
  } = useForm({
    disabled: Boolean(annotationScoreId && existingAnnotationScore.isLoading),
    defaultValues: {
      name: "",
      dataType: "boolean",
      description: "",
      category: Array(5).fill(""),
      categoryExplanation: Array(5).fill(""),
    },
  });

  useEffect(() => {
    if (!existingAnnotationScore.data) return;

    reset({
      name: existingAnnotationScore.data.name,
      dataType: existingAnnotationScore.data.dataType ?? "boolean",
      description: existingAnnotationScore.data.description ?? "",
      category: [],
      categoryExplanation: [],
    });

    setDefaultRadioOption("");
    setDefaultCheckboxOption([]);
    if (existingAnnotationScore.data.options && Array.isArray(existingAnnotationScore.data.options)) {
      setScoreTypeOptions((existingAnnotationScore.data.options as { value: string }[]).map(o => o.value) as string[]);
    }

    switch (existingAnnotationScore.data.dataType) {
      case AnnotationScoreDataType.OPTION:
        setDefaultRadioOption((existingAnnotationScore.data.defaultValue as { value: string }).value);
        break;
        case AnnotationScoreDataType.CHECKBOX:
        setDefaultCheckboxOption((existingAnnotationScore.data.defaultValue as { options: string[] }).options);
        break;
    }
  }, [existingAnnotationScore.data?.id, existingAnnotationScore.data?.updatedAt]);

  const [scoreTypeOptions, setScoreTypeOptions] = useState<string[]>([""]);
  const [defaultRadioOption, setDefaultRadioOption] = useState<string>("");
  const [defaultCheckboxOption, setDefaultCheckboxOption] = useState<string[]>([]);

  const onSubmit = (data: FormData) => {
    if (
      scoreTypeOptions.length === 0 ||
      scoreTypeOptions.every((opt) => !opt.trim())
    ) {
      toaster.create({
        title: "Error creating annotation score",
        description: "Please add at least one option",
        type: "error",
        meta: {
          closable: true,
        },
        placement: "top-end",
      });
      return;
    }

    const trimmedRadioCheckboxOptions = scoreTypeOptions.filter(
      (opt) => opt.trim() !== ""
    );

    const normalizedOptions = trimmedRadioCheckboxOptions.map((opt) =>
      opt.toLowerCase()
    );
    if (normalizedOptions.length !== new Set(normalizedOptions).size) {
      toaster.create({
        title: "Error creating annotation score",
        description: "Duplicate options are not allowed (case-insensitive)",
        type: "error",
        meta: {
          closable: true,
        },
        placement: "top-end",
      });
      return;
    }

    upsertAnnotationScore.mutate(
      {
        annotationScoreId: annotationScoreId,
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
          toaster.create({
            title: annotationScoreId ? "Annotation Score Updated" : "Annotation Score Created",
            description: `Successfully ${annotationScoreId ? "updated" : "created"} ${data.name} annotation score`,
            type: "success",
            meta: {
              closable: true,
            },
            placement: "top-end",
          });

          onClose();
          reset();

          void queryClient.annotationScore.getAllActive.invalidate();
          void queryClient.annotationScore.getAll.invalidate();
          void queryClient.annotationScore.getById.invalidate();
        },
        onError: (error) => {
          toaster.create({
            title: annotationScoreId ? "Error updating annotation score" : "Error creating annotation score",
            description: error.message,
            type: "error",
            meta: {
              closable: true,
            },
            placement: "top-end",
          });
        },
      }
    );
  };

  const watchDataType = watch("dataType");

  return (
    <>
      {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
      <form onSubmit={handleSubmit(onSubmit)}>
        <VStack gap={2} align="start">
          <FullWidthFormControl
            label="Name"
            helper="Give it a name that makes it easy to identify this score metric"
            invalid={!!errors.name}
          >
            <Input {...register("name")} required />
          </FullWidthFormControl>
          <FullWidthFormControl
            label="Description"
            helper="Provide a description of the score metric"
            invalid={!!errors.description}
          >
            <Textarea
              {...register("description")}
              required
              autoresize
              maxHeight="6lh"
            />
          </FullWidthFormControl>
          <FullWidthFormControl
            label="Score Type"
            helper={
              watchDataType === "OPTION"
                ? "Single selection from multiple options"
                : watchDataType === "CHECKBOX"
                ? "Allow multiple selections with checkboxes"
                : "Select the score type for the score metric"
            }
            invalid={!!errors.dataType}
          >
            <HStack width="full">
              <VStack align="start" width="full" gap={0}>
                <NativeSelect.Root>
                  <NativeSelect.Field {...register("dataType")}>
                    <option value={AnnotationScoreDataType.OPTION}>
                      Multiple choice
                    </option>
                    <option value={AnnotationScoreDataType.CHECKBOX}>
                      Checkboxes
                    </option>
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              </VStack>
            </HStack>

            {watchDataType === "OPTION" && (
              <Field.Root mt={4}>
                <VStack align="start" width="full" gap={2}>
                  <RadioGroup
                    verticalAlign="start"
                    width="full"
                    defaultValue={defaultRadioOption}
                    value={defaultRadioOption}
                  >
                    <VStack align="start" width="full" gap={2}>
                      {scoreTypeOptions.map((option, index) => (
                        <HStack key={index} gap={2} width="full">
                          <Radio
                            value={option}
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
                              const newOptions = [...scoreTypeOptions];
                              newOptions[index] = e.target.value;
                              setScoreTypeOptions(newOptions);
                            }}
                          />
                          <IconButton
                            aria-label="Remove option"
                            colorPalette="gray"
                            onClick={() => {
                              const newOptions = scoreTypeOptions.filter(
                                (_, i) => i !== index
                              );
                              setScoreTypeOptions(newOptions);
                            }}
                            disabled={scoreTypeOptions.length === 1}
                          >
                            <X />
                          </IconButton>
                        </HStack>
                      ))}
                    </VStack>
                  </RadioGroup>

                  <Button
                    onClick={() =>
                      setScoreTypeOptions([...scoreTypeOptions, ""])
                    }
                    size="sm"
                    colorPalette="orange"
                  >
                    <Plus />
                    Add Option
                  </Button>
                  {defaultRadioOption !== "" && (
                    <Field.HelperText>
                      <HStack>
                        <X
                          size={16}
                          cursor="pointer"
                          onClick={() => setDefaultRadioOption("")}
                        />
                        Default Option: <Text>{defaultRadioOption} </Text>
                      </HStack>
                    </Field.HelperText>
                  )}
                </VStack>
              </Field.Root>
            )}
            {watchDataType === "CHECKBOX" && (
              <Field.Root mt={4}>
                <VStack align="start" width="full">
                  {scoreTypeOptions.map((option, index) => (
                    <HStack key={index} width="full">
                      <Box
                        onClick={(e) => {
                          if (defaultCheckboxOption.includes(option)) {
                            setTimeout(() => {
                              setDefaultCheckboxOption(
                                defaultCheckboxOption.filter(
                                  (opt) => opt !== option
                                )
                              );
                            }, 100);
                          } else {
                            if (option.trim() !== "") {
                              setDefaultCheckboxOption([
                                ...defaultCheckboxOption,
                                option,
                              ]);
                            }
                          }
                        }}
                      >
                        <Checkbox
                          value={option}
                          checked={defaultCheckboxOption.includes(option)}
                          disabled={!option.trim()}
                        />
                      </Box>
                      <Input
                        placeholder="value"
                        value={option}
                        onChange={(e) => {
                          const newOptions = [...scoreTypeOptions];
                          newOptions[index] = e.target.value;
                          setScoreTypeOptions(newOptions);
                        }}
                      />
                      <IconButton
                        aria-label="Remove option"
                        colorPalette="gray"
                        onClick={() => {
                          const newOptions = scoreTypeOptions.filter(
                            (_, i) => i !== index
                          );
                          setScoreTypeOptions(newOptions);
                        }}
                        disabled={scoreTypeOptions.length === 1}
                      >
                        <X />
                      </IconButton>
                    </HStack>
                  ))}
                  <Button
                    onClick={() =>
                      setScoreTypeOptions([...scoreTypeOptions, ""])
                    }
                    size="sm"
                    colorPalette="orange"
                  >
                    <Plus />
                    Add Option
                  </Button>
                  {defaultCheckboxOption.length > 0 && (
                    <Field.HelperText>
                      <HStack>
                        <X
                          size={16}
                          cursor="pointer"
                          onClick={() => setDefaultCheckboxOption([])}
                        />
                        Default Options:{" "}
                        <Text>{defaultCheckboxOption.join(", ")}</Text>
                      </HStack>
                    </Field.HelperText>
                  )}
                </VStack>
              </Field.Root>
            )}
          </FullWidthFormControl>

          <HStack width="full">
            <Spacer />
            <Button colorPalette="orange" type="submit" minWidth="fit-content">
              {annotationScoreId ? "Update Score Metric" : "Add Score Metric"}
            </Button>
          </HStack>
        </VStack>
      </form>
    </>
  );
};
