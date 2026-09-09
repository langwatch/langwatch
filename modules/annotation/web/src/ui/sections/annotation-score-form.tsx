import type { AnnotationScoreDataType as AnnotationScoreDataTypeName } from "@langwatch/annotation-contract";
import { AnnotationScoreDataType } from "../../model/annotation-score-data-type.ts";
import { Input, Textarea } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { AnnotationScoreEditor } from "../blocks/annotation-score-editor.tsx";
import { annotationScoresApi } from "../../behavior/annotation-scores-api.ts";
import { useAnnotationScoresHost } from "../../model/annotation-scores-host.ts";

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

type AnnotationScoreFormProps = {
  onClose: () => void;
  annotationScoreId?: string | undefined;
};

function initialFormValues(): FormData {
  return {
    name: "",
    dataType: "boolean",
    description: "",
    category: Array(5).fill(""),
    categoryExplanation: Array(5).fill(""),
  };
}

function readOptionValues(options: unknown): string[] {
  if (!Array.isArray(options)) {
    return [];
  }

  return options
    .filter((option): option is { value: string } => {
      return option !== null && typeof option === "object" && "value" in option;
    })
    .map((option) => option.value);
}

function useExistingScoreDefaults({
  score,
  reset,
  setScoreTypeOptions,
  setDefaultRadioOption,
  setDefaultCheckboxOption,
}: {
  score:
    | {
        name: string;
        dataType?: string | null;
        description?: string | null;
        options?: unknown;
        defaultValue?: unknown;
      }
    | null
    | undefined;
  reset: (values: FormData) => void;
  setScoreTypeOptions: (options: string[]) => void;
  setDefaultRadioOption: (option: string) => void;
  setDefaultCheckboxOption: (options: string[]) => void;
}) {
  useEffect(() => {
    if (!score) {
      return;
    }

    reset({
      ...initialFormValues(),
      name: score.name,
      dataType: score.dataType ?? "boolean",
      description: score.description ?? "",
    });

    setScoreTypeOptions(readOptionValues(score.options));
    setDefaultRadioOption("");
    setDefaultCheckboxOption([]);

    if (score.dataType === AnnotationScoreDataType.OPTION) {
      setDefaultRadioOption((score.defaultValue as { value?: string } | null)?.value ?? "");
    }

    if (score.dataType === AnnotationScoreDataType.CHECKBOX) {
      setDefaultCheckboxOption(
        (score.defaultValue as { options?: string[] } | null)?.options ?? [],
      );
    }
  }, [reset, score, setDefaultCheckboxOption, setDefaultRadioOption, setScoreTypeOptions]);
}

function hasDuplicateOptions(options: string[]): boolean {
  const normalized = options.map((option) => option.toLowerCase());

  return normalized.length !== new Set(normalized).size;
}

function scoreFailureTitle(annotationScoreId: string | undefined): string {
  return annotationScoreId ? "Error updating annotation score" : "Error creating annotation score";
}

function useScoreSubmit({
  annotationScoreId,
  scoreTypeOptions,
  defaultRadioOption,
  defaultCheckboxOption,
  projectId,
  onClose,
  reset,
}: {
  annotationScoreId: string | undefined;
  scoreTypeOptions: string[];
  defaultRadioOption: string;
  defaultCheckboxOption: string[];
  projectId: string;
  onClose: () => void;
  reset: () => void;
}) {
  const host = useAnnotationScoresHost();
  const upsertAnnotationScore = annotationScoresApi.annotationScore.upsert.useMutation();
  const queryClient = annotationScoresApi.useUtils();

  const onSubmit = (data: FormData) => {
    const radioCheckboxOptions = scoreTypeOptions.filter((option) => option.trim() !== "");

    if (radioCheckboxOptions.length === 0) {
      host.failed({
        error: new Error("An annotation score needs at least one option"),
        fallbackTitle: scoreFailureTitle(annotationScoreId),
        description: "Please add at least one option",
      });

      return;
    }

    if (hasDuplicateOptions(radioCheckboxOptions)) {
      host.failed({
        error: new Error("Two options on this score read the same"),
        fallbackTitle: scoreFailureTitle(annotationScoreId),
        description: "Duplicate options are not allowed (case-insensitive)",
      });

      return;
    }

    upsertAnnotationScore.mutate(
      {
        annotationScoreId,
        name: data.name,
        dataType: data.dataType as AnnotationScoreDataTypeName,
        description: data.description,
        category: data.category,
        categoryExplanation: data.categoryExplanation,
        projectId,
        options: data.options,
        radioCheckboxOptions,
        defaultRadioOption,
        defaultCheckboxOption,
      },
      {
        onSuccess: (score) => {
          host.succeeded({
            title: annotationScoreId ? "Annotation Score Updated" : "Annotation Score Created",
            description: `Successfully ${annotationScoreId ? "updated" : "created"} ${score.name} annotation score`,
          });

          onClose();
          reset();
          void queryClient.annotationScore.getAllActive.invalidate();
          void queryClient.annotationScore.getAll.invalidate();
          void queryClient.annotationScore.getById.invalidate();
        },
        onError: (error) =>
          host.failed({
            error,
            fallbackTitle: annotationScoreId
              ? "Couldn't save annotation score"
              : "Couldn't create annotation score",
          }),
      },
    );
  };

  return { isSaving: upsertAnnotationScore.isPending, onSubmit };
}

export const AnnotationScoreForm = ({ onClose, annotationScoreId }: AnnotationScoreFormProps) => {
  const host = useAnnotationScoresHost();
  const project = host.project();

  const existingAnnotationScore = annotationScoresApi.annotationScore.getById.useQuery(
    {
      projectId: project?.id ?? "",
      scoreId: annotationScoreId ?? "",
    },
    { enabled: !!annotationScoreId && !!project?.id },
  );

  const form = useForm<FormData>({
    disabled: Boolean(annotationScoreId && existingAnnotationScore.isLoading),
    defaultValues: initialFormValues(),
  });

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
    reset,
  } = form;

  const [scoreTypeOptions, setScoreTypeOptions] = useState<string[]>([""]);
  const [defaultRadioOption, setDefaultRadioOption] = useState<string>("");
  const [defaultCheckboxOption, setDefaultCheckboxOption] = useState<string[]>([]);

  useExistingScoreDefaults({
    score: existingAnnotationScore.data,
    reset,
    setScoreTypeOptions,
    setDefaultRadioOption,
    setDefaultCheckboxOption,
  });

  const { isSaving, onSubmit } = useScoreSubmit({
    annotationScoreId,
    scoreTypeOptions,
    defaultRadioOption,
    defaultCheckboxOption,
    projectId: project?.id ?? "",
    onClose,
    reset,
  });

  const watchDataType = watch("dataType");

  return (
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    <form onSubmit={handleSubmit(onSubmit)}>
      <AnnotationScoreEditor
        formError={null}
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
          setScoreTypeOptions(scoreTypeOptions.filter((_, optionIndex) => optionIndex !== index))
        }
        onOptionAdd={() => setScoreTypeOptions([...scoreTypeOptions, ""])}
        defaultRadioOption={defaultRadioOption}
        onDefaultRadioOptionChange={setDefaultRadioOption}
        defaultCheckboxOptions={defaultCheckboxOption}
        onDefaultCheckboxOptionsChange={setDefaultCheckboxOption}
        isSaving={isSaving}
        submitLabel={annotationScoreId ? "Update Score Metric" : "Add Score Metric"}
      />
    </form>
  );
};
