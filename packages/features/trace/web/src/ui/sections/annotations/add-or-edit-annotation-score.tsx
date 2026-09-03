import { Input, Textarea } from "@chakra-ui/react";
import { AnnotationScoreEditor } from "@langwatch/annotation-web";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import {
  applyHandledErrorToForm,
  FormServerError,
  showErrorToast,
} from "../errors";
import { AnnotationScoreDataType } from "../../../model/prisma-types";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project";
import { api } from "../trace-api";
import { toaster } from "@langwatch/design-system/toaster";

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
  onClose: () => void;
  annotationScoreId?: string | undefined;
}) => {
  const { project } = useOrganizationTeamProject();
  const upsertAnnotationScore = api.annotationScore.upsert.useMutation();
  const existingAnnotationScore = api.annotationScore.getById.useQuery(
    {
      projectId: project?.id ?? "",
      scoreId: annotationScoreId ?? "",
    },
    { enabled: !!annotationScoreId && !!project?.id },
  );

  const queryClient = api.useUtils();

  const form = useForm({
    disabled: Boolean(annotationScoreId && existingAnnotationScore.isLoading),
    defaultValues: {
      name: "",
      dataType: "boolean",
      description: "",
      category: Array(5).fill(""),
      categoryExplanation: Array(5).fill(""),
    },
  });
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
    reset,
  } = form;

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
    if (
      existingAnnotationScore.data.options &&
      Array.isArray(existingAnnotationScore.data.options)
    ) {
      setScoreTypeOptions(
        existingAnnotationScore.data.options
          .filter(
            (o): o is { value: string } =>
              o !== null && typeof o === "object" && "value" in o,
          )
          .map((o) => o.value),
      );
    }

    switch (existingAnnotationScore.data.dataType) {
      case AnnotationScoreDataType.OPTION:
        setDefaultRadioOption(
          (existingAnnotationScore.data.defaultValue as { value: string })?.value,
        );
        break;
      case AnnotationScoreDataType.CHECKBOX:
        setDefaultCheckboxOption(
          (existingAnnotationScore.data.defaultValue as { options: string[] })?.options,
        );
        break;
    }
  }, [existingAnnotationScore.data?.id, existingAnnotationScore.data?.updatedAt]);

  const [scoreTypeOptions, setScoreTypeOptions] = useState<string[]>([""]);
  const [defaultRadioOption, setDefaultRadioOption] = useState<string>("");
  const [defaultCheckboxOption, setDefaultCheckboxOption] = useState<string[]>([]);

  const onSubmit = (data: FormData) => {
    if (scoreTypeOptions.every((option) => !option.trim())) {
      showErrorToast({
        fallbackTitle: annotationScoreId
          ? "Couldn't update the annotation score"
          : "Couldn't create the annotation score",
        description: "Add at least one option.",
      });
      return;
    }

    const trimmedRadioCheckboxOptions = scoreTypeOptions.filter(
      (opt) => opt.trim() !== "",
    );

    const normalizedOptions = trimmedRadioCheckboxOptions.map((opt) => opt.toLowerCase());
    if (normalizedOptions.length !== new Set(normalizedOptions).size) {
      showErrorToast({
        fallbackTitle: annotationScoreId
          ? "Couldn't update the annotation score"
          : "Couldn't create the annotation score",
        description: "Options must be different from one another, ignoring case.",
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
            title: annotationScoreId
              ? "Annotation Score Updated"
              : "Annotation Score Created",
            description: `Successfully ${annotationScoreId ? "updated" : "created"} ${data.name} annotation score`,
            type: "success",
          });

          onClose();
          reset();

          void queryClient.annotationScore.getAllActive.invalidate();
          void queryClient.annotationScore.getAll.invalidate();
          void queryClient.annotationScore.getById.invalidate();
        },
        onError: (error) => {
          if (applyHandledErrorToForm({ error, form, hasFormErrorSlot: true })) return;
          showErrorToast({
            error,
            fallbackTitle: annotationScoreId
              ? "Couldn't save annotation score"
              : "Couldn't create annotation score",
          });
        },
      },
    );
  };

  const watchDataType = watch("dataType");

  return (
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    <form onSubmit={handleSubmit(onSubmit)}>
      <AnnotationScoreEditor
        formError={<FormServerError form={form} />}
        nameField={<Input {...register("name")} required />}
        nameError={errors.name?.message}
        descriptionField={
          <Textarea {...register("description")} required autoresize maxHeight="6lh" />
        }
        descriptionError={errors.description?.message}
        dataType={watchDataType}
        dataTypeError={errors.dataType?.message}
        onDataTypeChange={(dataType) => setValue("dataType", dataType)}
        options={scoreTypeOptions}
        onOptionChange={(index, option) => {
          const nextOptions = [...scoreTypeOptions];
          nextOptions[index] = option;
          setScoreTypeOptions(nextOptions);
        }}
        onOptionRemove={(index) =>
          setScoreTypeOptions(
            scoreTypeOptions.filter((_, optionIndex) => optionIndex !== index),
          )
        }
        onOptionAdd={() => setScoreTypeOptions([...scoreTypeOptions, ""])}
        defaultRadioOption={defaultRadioOption}
        onDefaultRadioOptionChange={setDefaultRadioOption}
        defaultCheckboxOptions={defaultCheckboxOption}
        onDefaultCheckboxOptionsChange={setDefaultCheckboxOption}
        isSaving={upsertAnnotationScore.isPending}
        submitLabel={annotationScoreId ? "Update Score Metric" : "Add Score Metric"}
      />
    </form>
  );
};
