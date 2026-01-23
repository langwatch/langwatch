import {
  Accordion,
  Field,
  HStack,
  Input,
  NativeSelect,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef } from "react";
import { Controller, type UseFormReturn, useForm } from "react-hook-form";
import { z } from "zod";
import { useScenarioFormStore } from "../../hooks/useScenarioFormStore";
import { CriteriaInput } from "./ui/CriteriaInput";
import { InlineTagsInput } from "./ui/InlineTagsInput";
import { SectionHeader } from "./ui/SectionHeader";

/**
 * Zod schema for scenario form validation.
 * Colocated with the form component it validates.
 */
export const scenarioFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  situation: z.string(),
  criteria: z.array(z.string()),
  labels: z.array(z.string()),
});

export type ScenarioFormData = z.infer<typeof scenarioFormSchema>;

type ScenarioFormProps = {
  defaultValues?: Partial<ScenarioFormData>;
  formRef?: (form: UseFormReturn<ScenarioFormData>) => void;
  /** If true, use Zustand store for persistence across drawer navigation */
  persistToStore?: boolean;
  /** Current scenario ID - used to validate stored data belongs to this scenario */
  scenarioId?: string;
};

/**
 * Pure UI form for creating/editing scenarios.
 * Matches the design mockup layout.
 * Submit is handled externally via formRef.
 *
 * When persistToStore is true, form state is synced to Zustand store
 * so it survives drawer navigation (e.g., opening prompt picker).
 */
export function ScenarioForm({
  defaultValues,
  formRef,
  persistToStore = false,
  scenarioId,
}: ScenarioFormProps) {
  const {
    formData: storedFormData,
    scenarioId: storedScenarioId,
    setFormData,
  } = useScenarioFormStore();

  // Only use stored data if it's for the current scenario
  // This prevents showing stale data when switching between scenarios
  const storedDataMatchesScenario =
    persistToStore &&
    ((scenarioId && storedScenarioId === scenarioId) ||
      (!scenarioId && storedScenarioId === null));

  // Use stored data if it matches current scenario, otherwise use defaultValues
  const initialValues = storedDataMatchesScenario
    ? { ...storedFormData }
    : {
        name: "",
        situation: "",
        criteria: [],
        labels: [],
        ...defaultValues,
      };

  const form = useForm<ScenarioFormData>({
    defaultValues: initialValues,
    resolver: zodResolver(scenarioFormSchema),
  });

  const {
    register,
    control,
    reset,
    watch,
    formState: { errors },
  } = form;

  // Expose form to parent
  useEffect(() => {
    formRef?.(form);
  }, [form, formRef]);

  // Sync form changes to store when persistToStore is enabled
  useEffect(() => {
    if (!persistToStore) return;

    const subscription = watch((data) => {
      setFormData(data as Partial<ScenarioFormData>);
    });

    return () => subscription.unsubscribe();
  }, [watch, setFormData, persistToStore]);

  // Also reset form when defaultValues change AND we're using store persistence
  // but the stored data doesn't match (i.e., switching scenarios)
  useEffect(() => {
    if (!persistToStore || storedDataMatchesScenario) return;

    // Stored data is stale - reset form to defaultValues
    reset({
      name: "",
      situation: "",
      criteria: [],
      labels: [],
      ...defaultValues,
    });
  }, [persistToStore, storedDataMatchesScenario, defaultValues, reset]);

  // Reset form when defaultValues change (only when NOT using store persistence)
  const prevDefaultsRef = useRef<string | null>(null);
  useEffect(() => {
    if (persistToStore) return; // Don't auto-reset when using store

    const currentDefaults = defaultValues
      ? JSON.stringify([
          defaultValues.name,
          defaultValues.situation,
          defaultValues.criteria,
          defaultValues.labels,
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
          ...defaultValues,
        });
      }
    }
  }, [defaultValues, reset, persistToStore]);

  return (
    <VStack align="stretch" gap={6}>
      {/* SCENARIO Section */}
      <VStack align="stretch" gap={3}>
        <SectionHeader>Scenario</SectionHeader>

        {/* Name */}
        <Field.Root invalid={!!errors.name}>
          <Field.Label fontWeight="medium">Name</Field.Label>
          <Input
            {...register("name")}
            placeholder="e.g., Angry refund request"
          />
          <Field.ErrorText>{errors.name?.message}</Field.ErrorText>
        </Field.Root>

        {/* Labels */}
        <Field.Root>
          <Field.Label fontWeight="medium">Labels</Field.Label>
          <Field.HelperText margin={0} marginBottom={2} fontSize="13px">
            Use labels for filtering, e.g. critical, billing, edge-case
          </Field.HelperText>
          <Controller
            name="labels"
            control={control}
            render={({ field }) => (
              <InlineTagsInput
                value={field.value}
                onChange={field.onChange}
                placeholder="Add label..."
              />
            )}
          />
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
    </VStack>
  );
}
