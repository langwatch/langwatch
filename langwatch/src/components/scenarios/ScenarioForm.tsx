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
import { Controller, useForm, type UseFormReturn } from "react-hook-form";
import { z } from "zod";
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

  // Expose form to parent
  useEffect(() => {
    formRef?.(form);
  }, [form, formRef]);

  // Reset form when defaultValues change (using ref to track previous serialized values)
  const prevDefaultsRef = useRef<string | null>(null);
  useEffect(() => {
    const currentDefaults = defaultValues
      ? JSON.stringify([defaultValues.name, defaultValues.situation, defaultValues.criteria, defaultValues.labels])
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
  }, [defaultValues, reset]);

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
        <VStack align="stretch" gap={2}>
          <Text fontWeight="medium" fontSize="sm">
            Labels
          </Text>
          <Controller
            name="labels"
            control={control}
            render={({ field }) => (
              <InlineTagsInput
                value={field.value}
                onChange={field.onChange}
                placeholder="Label name..."
              />
            )}
          />
        </VStack>
      </VStack>

      {/* SITUATION Section */}
      <VStack align="stretch" gap={3}>
        <SectionHeader>Situation</SectionHeader>
        <Field.Root invalid={!!errors.situation}>
          <Textarea
            {...register("situation")}
            placeholder="Describe the context and setup for this scenario..."
            rows={5}
          />
          <Field.ErrorText>{errors.situation?.message}</Field.ErrorText>
        </Field.Root>
      </VStack>

      {/* CRITERIA Section */}
      <VStack align="stretch" gap={3}>
        <SectionHeader>Criteria</SectionHeader>
        <Controller
          name="criteria"
          control={control}
          render={({ field }) => (
            <CriteriaInput
              value={field.value}
              onChange={field.onChange}
              placeholder="Add a criterion..."
            />
          )}
        />
      </VStack>
    </VStack>
  );
}
