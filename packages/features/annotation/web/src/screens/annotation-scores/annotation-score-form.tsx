/**
 * The add-and-edit form for one score definition.
 *
 * MOVED WITH THE SETTINGS PAGE THAT OPENS IT, and it is a second copy rather
 * than a repoint: the traces family took the platform original into
 * `@langwatch/trace-web` for the annotation-queue drawer, and this package
 * cannot import that one — `trace-web` depends on `annotation-web`, so the edge
 * back would close a cycle. The two dies down to one when the queue drawer's
 * copy of the editor moves here, which is the annotations family's to do.
 *
 * WHAT DID NOT TRAVEL is the form-level server-error slot. It came from
 * `platform/app`'s `features/errors`, whose presentation registry has not moved
 * out of that application yet; a rejected save reports through the host's
 * failure notice instead, which resolves the same code-keyed copy. Recorded
 * rather than silently dropped: a field-level rejection now reads as a notice
 * rather than as a message under the field.
 */

import type { AnnotationScoreDataType as AnnotationScoreDataTypeName } from "@langwatch/annotation-contract";
import { AnnotationScoreDataType } from "./annotation-score-data-type";
import { Input, Textarea } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { AnnotationScoreEditor } from "../../ui/blocks/annotation-score-editor";
import { annotationScoresApi } from "./annotation-scores-api";
import { useAnnotationScoresHost } from "./annotation-scores-host";

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

export const AnnotationScoreForm = ({
  onClose,
  annotationScoreId,
}: {
  onClose: () => void;
  annotationScoreId?: string | undefined;
}) => {
  const host = useAnnotationScoresHost();
  const project = host.project();
  const upsertAnnotationScore = annotationScoresApi.annotationScore.upsert.useMutation();
  const existingAnnotationScore = annotationScoresApi.annotationScore.getById.useQuery(
    {
      projectId: project?.id ?? "",
      scoreId: annotationScoreId ?? "",
    },
    { enabled: !!annotationScoreId && !!project?.id },
  );

  const queryClient = annotationScoresApi.useUtils();

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
            (o): o is { value: string } => o !== null && typeof o === "object" && "value" in o,
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
      host.failed({
        error: new Error("An annotation score needs at least one option"),
        fallbackTitle: annotationScoreId
          ? "Error updating annotation score"
          : "Error creating annotation score",
        description: "Please add at least one option",
      });
      return;
    }

    const trimmedRadioCheckboxOptions = scoreTypeOptions.filter((opt) => opt.trim() !== "");

    const normalizedOptions = trimmedRadioCheckboxOptions.map((opt) => opt.toLowerCase());
    if (normalizedOptions.length !== new Set(normalizedOptions).size) {
      host.failed({
        error: new Error("Two options on this score read the same"),
        fallbackTitle: annotationScoreId
          ? "Error updating annotation score"
          : "Error creating annotation score",
        description: "Duplicate options are not allowed (case-insensitive)",
      });
      return;
    }

    upsertAnnotationScore.mutate(
      {
        annotationScoreId: annotationScoreId,
        name: data.name,
        dataType: data.dataType as AnnotationScoreDataTypeName,
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
          host.succeeded({
            title: annotationScoreId ? "Annotation Score Updated" : "Annotation Score Created",
            description: `Successfully ${annotationScoreId ? "updated" : "created"} ${data.name} annotation score`,
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

  const watchDataType = watch("dataType");

  return (
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    <form onSubmit={handleSubmit(onSubmit)}>
      {/* The form-error slot stays empty: this form's failures are named by
          the host's presentation registry and shown as a notice, not inline. */}
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
        isSaving={upsertAnnotationScore.isPending}
        submitLabel={annotationScoreId ? "Update Score Metric" : "Add Score Metric"}
      />
    </form>
  );
};
