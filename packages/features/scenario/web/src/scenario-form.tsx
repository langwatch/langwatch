import {
  Collapsible,
  Field,
  HStack,
  Input,
  NativeSelect,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type Control,
  Controller,
  type FieldErrors,
  type SubmitErrorHandler,
  type SubmitHandler,
  type UseFormRegister,
  type UseFormReset,
  type UseFormReturn,
  type UseFormSetError,
  useForm,
} from "react-hook-form";
import { scenarioParameterDefinitionsSchema } from "@langwatch/scenario-contract";
import { z } from "zod";
import { ScenarioCriteriaInput } from "./scenario-criteria-input";
import { ScenarioSectionHeader } from "./scenario-section-header";

/** Parameters reuse the saved definition schema, so form and service agree. */
export const scenarioFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  situation: z.string(),
  criteria: z.array(z.string()),
  labels: z.array(z.string()),
  parameters: scenarioParameterDefinitionsSchema,
  maxTurns: z.number().int().min(1).max(100).nullish(),
  minTurns: z.number().int().min(0).max(100).nullish(),
  // The test suite the case is filed in. Absent keeps the suite the case has,
  // null files it nowhere. Only the Agent Testing editor offers the field.
  folderId: z.string().nullish(),
});

export type ScenarioFormData = z.infer<typeof scenarioFormSchema>;

/** One test suite the case can be filed in. */
export type ScenarioFolderOption = { id: string; name: string };

/** What "no test suite" reads as in the suite field. */
export const UNFILED_OPTION_LABEL = "No test suite";

/** Unsaved initial values passed into the application drawer composition. */
export interface ScenarioInitialData {
  initialFormData: Partial<ScenarioFormData>;
}

type ScenarioFormProps = {
  defaultValues?: Partial<ScenarioFormData>;
  onControllerChange?: (controller: ScenarioFormController | null) => void;
  /**
   * The test suites the case can be filed in. Absent hides the field, which
   * is what every surface outside Agent Testing does.
   */
  folderOptions?: ScenarioFolderOption[];
};

/** Narrow composition port for the app-owned drawer, transport and AI actions. */
export interface ScenarioFormController {
  control: Control<ScenarioFormData>;
  read(): ScenarioFormData;
  read<Name extends keyof ScenarioFormData>(name: Name): ScenarioFormData[Name];
  update<Name extends keyof ScenarioFormData>(name: Name, value: ScenarioFormData[Name]): void;
  setError: UseFormSetError<ScenarioFormData>;
  validate(): Promise<boolean>;
  errors(): FieldErrors<ScenarioFormData>;
  submit(
    onValid: SubmitHandler<ScenarioFormData>,
    onInvalid?: SubmitErrorHandler<ScenarioFormData>,
  ): Promise<void>;
}

/** Controlled scenario form. The application owns submission through its port. */
export function ScenarioForm({
  defaultValues,
  onControllerChange,
  folderOptions,
}: ScenarioFormProps) {
  const form = useForm<ScenarioFormData>({
    defaultValues: {
      name: "",
      situation: "",
      criteria: [],
      labels: [],
      parameters: [],
      ...defaultValues,
    },
    resolver: zodResolver(scenarioFormSchema),
  });

  const {
    register,
    control,
    reset,
    formState: { errors },
  } = form;
  const controller = useMemo(() => createController(form), [form]);

  useEffect(() => {
    onControllerChange?.(controller);
    return () => onControllerChange?.(null);
  }, [controller, onControllerChange]);

  useResetOnDefaultsChange({ reset, defaultValues });

  return (
    <VStack align="stretch" gap={6}>
      <VStack align="stretch" gap={3}>
        <Field.Root invalid={!!errors.name}>
          <ScenarioSectionHeader>Name</ScenarioSectionHeader>
          <Input {...register("name")} placeholder="e.g., Angry refund request" />
          <Field.ErrorText>{errors.name?.message}</Field.ErrorText>
        </Field.Root>
      </VStack>

      {folderOptions && (
        <VStack align="stretch" gap={3}>
          <Field.Root>
            <ScenarioSectionHeader>Test suite</ScenarioSectionHeader>
            <Controller
              name="folderId"
              control={control}
              render={({ field }) => (
                <NativeSelect.Root size="sm">
                  <NativeSelect.Field
                    aria-label="Test suite"
                    value={field.value ?? ""}
                    onChange={(event) => field.onChange(event.target.value || null)}
                  >
                    <option value="">{UNFILED_OPTION_LABEL}</option>
                    {folderOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              )}
            />
          </Field.Root>
        </VStack>
      )}
      <VStack align="stretch" gap={3}>
        <VStack align="stretch" gap={1}>
          <ScenarioSectionHeader>Situation</ScenarioSectionHeader>
          <Text fontSize="13px" color="fg.muted">
            Describe the user, their context, and what they're trying to accomplish. Think about a
            critical path or a complex edge case.
          </Text>
        </VStack>
        <Field.Root invalid={!!errors.situation}>
          <Textarea
            {...register("situation")}
            placeholder="e.g., A frustrated premium subscriber who was charged twice..."
            rows={5}
            _placeholder={{ color: "gray.400", fontStyle: "italic" }}
          />
          <Field.ErrorText>{errors.situation?.message}</Field.ErrorText>
        </Field.Root>
      </VStack>

      <VStack align="stretch" gap={3}>
        <VStack align="stretch" gap={1}>
          <ScenarioSectionHeader>Criteria</ScenarioSectionHeader>
          <Text fontSize="13px" color="fg.muted">
            What must the agent DO or NOT DO? e.g. "Must remain empathetic", "Must NOT offer refund
            without manager approval"
          </Text>
        </VStack>
        <Controller
          name="criteria"
          control={control}
          render={({ field }) => (
            <ScenarioCriteriaInput
              value={field.value}
              onChange={field.onChange}
              placeholder="e.g., Must apologize for the inconvenience"
            />
          )}
        />
      </VStack>

      <AdvancedSection register={register} errors={errors} />
    </VStack>
  );
}

/** Re-seed only when values change, not when a parent rebuilds the object. */
function useResetOnDefaultsChange({
  reset,
  defaultValues,
}: {
  reset: UseFormReset<ScenarioFormData>;
  defaultValues?: Partial<ScenarioFormData>;
}) {
  const prevDefaultsRef = useRef<string | null>(null);
  useEffect(() => {
    const currentDefaults = defaultValues
      ? JSON.stringify([
          defaultValues.name,
          defaultValues.situation,
          defaultValues.criteria,
          defaultValues.labels,
          defaultValues.parameters,
          defaultValues.maxTurns,
          defaultValues.minTurns,
          defaultValues.folderId,
        ])
      : null;
    if (currentDefaults !== prevDefaultsRef.current) {
      prevDefaultsRef.current = currentDefaults;
      if (defaultValues) {
        reset({
          name: "",
          situation: "",
          criteria: [],
          labels: [],
          parameters: [],
          folderId: null,
          ...defaultValues,
        });
      }
    }
  }, [defaultValues, reset]);
}

function AdvancedSection({
  register,
  errors,
}: {
  register: UseFormRegister<ScenarioFormData>;
  errors: FieldErrors<ScenarioFormData>;
}) {
  const [open, setOpen] = useState(false);
  const ChevronIcon = open ? ChevronDown : ChevronRight;

  return (
    <Collapsible.Root open={open} onOpenChange={({ open }) => setOpen(open)}>
      <Collapsible.Trigger asChild>
        <HStack cursor="pointer" userSelect="none" _hover={{ color: "fg.emphasized" }}>
          <ChevronIcon size={14} />
          <ScenarioSectionHeader>Advanced</ScenarioSectionHeader>
        </HStack>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <VStack align="stretch" gap={3} pt={3}>
          <HStack gap={4} align="start">
            <Field.Root invalid={!!errors.maxTurns} flex={1}>
              <Text fontSize="13px" fontWeight="medium">
                Max Turns
              </Text>
              <Input
                {...register("maxTurns", {
                  setValueAs: optionalNumber,
                })}
                type="number"
                placeholder="Default: 10"
              />
              <Field.ErrorText>{errors.maxTurns?.message}</Field.ErrorText>
            </Field.Root>
            <Field.Root invalid={!!errors.minTurns} flex={1}>
              <Text fontSize="13px" fontWeight="medium">
                Min Turns
              </Text>
              <Input
                {...register("minTurns", {
                  setValueAs: optionalNumber,
                })}
                type="number"
                placeholder="Default: none"
              />
              <Field.ErrorText>{errors.minTurns?.message}</Field.ErrorText>
            </Field.Root>
          </HStack>
          <Text fontSize="12px" color="fg.muted">
            Max Turns caps the conversation length. Min Turns prevents the judge from ending the
            test early.
          </Text>
        </VStack>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

function createController(form: UseFormReturn<ScenarioFormData>): ScenarioFormController {
  return {
    control: form.control,
    read: form.getValues,
    update: form.setValue,
    setError: form.setError,
    validate: form.trigger,
    errors: () => form.formState.errors,
    submit: async (onValid, onInvalid) => {
      await form.handleSubmit(onValid, onInvalid)();
    },
  };
}

function optionalNumber(value: unknown): number | null {
  if (value == null || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}
