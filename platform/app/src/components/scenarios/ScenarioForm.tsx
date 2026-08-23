import {
  Collapsible,
  Field,
  HStack,
  Input,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Controller, type UseFormReturn, useForm } from "react-hook-form";
import { z } from "zod";
import { scenarioParameterDefinitionsSchema } from "~/server/scenarios/parameters";
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
  parameters: scenarioParameterDefinitionsSchema,
  maxTurns: z.number().int().min(1).max(100).nullish(),
  minTurns: z.number().int().min(0).max(100).nullish(),
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
            _placeholder={{ color: "fg.faint", fontStyle: "italic" }}
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

      <AdvancedSection register={register} errors={errors} />
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
          defaultValues.parameters,
          defaultValues.maxTurns,
          defaultValues.minTurns,
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
  register: ReturnType<typeof useForm<ScenarioFormData>>["register"];
  errors: ReturnType<typeof useForm<ScenarioFormData>>["formState"]["errors"];
}) {
  const [open, setOpen] = useState(false);
  const ChevronIcon = open ? ChevronDown : ChevronRight;

  return (
    <Collapsible.Root open={open} onOpenChange={({ open }) => setOpen(open)}>
      <Collapsible.Trigger asChild>
        <HStack
          cursor="pointer"
          userSelect="none"
          _hover={{ color: "fg.emphasized" }}
        >
          <ChevronIcon size={14} />
          <SectionHeader>Advanced</SectionHeader>
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
                  setValueAs: (v) =>
                    v == null || v === ""
                      ? null
                      : Number.isNaN(Number(v))
                        ? null
                        : Number(v),
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
                  setValueAs: (v) =>
                    v == null || v === ""
                      ? null
                      : Number.isNaN(Number(v))
                        ? null
                        : Number(v),
                })}
                type="number"
                placeholder="Default: none"
              />
              <Field.ErrorText>{errors.minTurns?.message}</Field.ErrorText>
            </Field.Root>
          </HStack>
          <Text fontSize="12px" color="fg.muted">
            Max Turns caps the conversation length. Min Turns prevents the judge
            from ending the test early.
          </Text>
        </VStack>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
