import { Field, Input, Text, Textarea, VStack } from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef } from "react";
import {
  Controller,
  type FieldError,
  type UseFormRegister,
  type UseFormReturn,
  useForm,
} from "react-hook-form";
import { z } from "zod";
import { scenarioParameterDefinitionsSchema } from "~/server/scenarios/parameters";
import {
  DEFAULT_SCENARIO_MAX_TURNS,
  MAX_SCENARIO_MAX_TURNS,
} from "~/server/scenarios/scenario.constants";
import { CriteriaInput } from "./ui/CriteriaInput";
import { SectionHeader } from "./ui/SectionHeader";

/**
 * Zod schema for scenario form validation.
 * Colocated with the form component it validates.
 *
 * Parameters reuse the server's schema rather than restating its caps, so the
 * form rejects exactly what the save would.
 */
export const scenarioFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  situation: z.string(),
  criteria: z.array(z.string()),
  labels: z.array(z.string()),
  // null means "use the default turn cap". The register call normalizes an
  // empty input to null before this schema runs.
  maxTurns: z
    .number({ invalid_type_error: "Maximum turns must be a whole number" })
    .int("Maximum turns must be a whole number")
    .min(1, `Maximum turns must be between 1 and ${MAX_SCENARIO_MAX_TURNS}`)
    .max(
      MAX_SCENARIO_MAX_TURNS,
      `Maximum turns must be between 1 and ${MAX_SCENARIO_MAX_TURNS}`,
    )
    .nullable(),
  parameters: scenarioParameterDefinitionsSchema,
});

export type ScenarioFormData = z.infer<typeof scenarioFormSchema>;

/**
 * Initial data passed to ScenarioFormDrawer via complexProps when creating
 * a new scenario. The scenario is NOT persisted until the user clicks Save.
 */
export interface ScenarioInitialData {
  initialFormData: Partial<ScenarioFormData>;
}

type ScenarioFormProps = {
  defaultValues?: Partial<ScenarioFormData>;
  formRef?: (form: UseFormReturn<ScenarioFormData> | null) => void;
};

/**
 * Pure UI form for creating/editing scenarios.
 * Matches the design mockup layout.
 * Submit is handled externally via formRef.
 */
export function ScenarioForm({ defaultValues, formRef }: ScenarioFormProps) {
  const form = useForm<ScenarioFormData>({
    defaultValues: {
      name: "",
      situation: "",
      criteria: [],
      labels: [],
      maxTurns: null,
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

  // Expose form to parent, and take it back on unmount. Whoever holds the
  // reference renders against it, so a reference that outlives this form
  // points them at a form nobody is typing in.
  useEffect(() => {
    formRef?.(form);
    return () => formRef?.(null);
  }, [form, formRef]);

  useResetOnDefaultsChange({ reset, defaultValues });

  return (
    <VStack align="stretch" gap={6}>
      {/* SCENARIO Section */}
      <VStack align="stretch" gap={3}>
        {/* Name */}
        <Field.Root invalid={!!errors.name}>
          <SectionHeader>Name</SectionHeader>
          <Input
            {...register("name")}
            placeholder="e.g., Angry refund request"
          />
          <Field.ErrorText>{errors.name?.message}</Field.ErrorText>
        </Field.Root>
      </VStack>

      {/* SITUATION Section */}
      <VStack align="stretch" gap={3}>
        <VStack align="stretch" gap={1}>
          <SectionHeader>Situation</SectionHeader>
          <Text fontSize="13px" color="fg.muted">
            Describe the user, their context, and what they're trying to
            accomplish. Think about a critical path or a complex edge case.
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

      {/* CRITERIA Section */}
      <VStack align="stretch" gap={3}>
        <VStack align="stretch" gap={1}>
          <SectionHeader>Criteria</SectionHeader>
          <Text fontSize="13px" color="fg.muted">
            What must the agent DO or NOT DO? e.g. "Must remain empathetic",
            "Must NOT offer refund without manager approval"
          </Text>
        </VStack>
        <Controller
          name="criteria"
          control={control}
          render={({ field }) => (
            <CriteriaInput
              value={field.value}
              onChange={field.onChange}
              placeholder="e.g., Must apologize for the inconvenience"
            />
          )}
        />
      </VStack>

      {/* MAXIMUM TURNS Section */}
      <MaxTurnsField register={register} error={errors.maxTurns} />
    </VStack>
  );
}

/**
 * Empty input means "use the default", so it stores null. Non-numeric text
 * passes through untouched so the schema rejects it visibly instead of
 * silently falling back to the default.
 */
function normalizeMaxTurnsInput(value: unknown): unknown {
  if (value === "" || value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? value : parsed;
}

function MaxTurnsField({
  register,
  error,
}: {
  register: UseFormRegister<ScenarioFormData>;
  error?: FieldError;
}) {
  return (
    <VStack align="stretch" gap={3}>
      <Field.Root invalid={!!error}>
        <Field.Label>
          <SectionHeader as="span">Maximum turns</SectionHeader>
        </Field.Label>
        <Text fontSize="13px" color="fg.muted">
          How many conversation turns the simulation may take before it stops.
          Leave empty to use the default of {DEFAULT_SCENARIO_MAX_TURNS} turns.
        </Text>
        <Input
          type="number"
          width="120px"
          min={1}
          max={MAX_SCENARIO_MAX_TURNS}
          {...register("maxTurns", { setValueAs: normalizeMaxTurnsInput })}
        />
        <Field.ErrorText>{error?.message}</Field.ErrorText>
      </Field.Root>
    </VStack>
  );
}

/**
 * Re-seeds the form when the scenario being edited changes.
 *
 * The previous defaults are tracked by value rather than by object identity: a
 * parent that rebuilds the object on every render would otherwise reset the
 * form under the user mid-edit.
 */
function useResetOnDefaultsChange({
  reset,
  defaultValues,
}: {
  reset: UseFormReturn<ScenarioFormData>["reset"];
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
          defaultValues.maxTurns,
          defaultValues.parameters,
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
          maxTurns: null,
          parameters: [],
          ...defaultValues,
        });
      }
    }
  }, [defaultValues, reset]);
}
