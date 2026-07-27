import {
  Accordion,
  Button,
  Field,
  HStack,
  Input,
  NativeSelect,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, ShieldAlert } from "lucide-react";
import { useEffect, useRef } from "react";
import {
  Controller,
  type UseFormReturn,
  useForm,
  useWatch,
} from "react-hook-form";
import { z } from "zod";
import {
  RED_TEAM_DEFAULT_TURNS,
  RedTeamAttackSection,
} from "./RedTeamAttackSection";
import { CriteriaInput } from "./ui/CriteriaInput";
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
  // Red-team configuration. Null strategy = a standard scenario; the form
  // shows the attack section only once a strategy is picked.
  redTeamStrategy: z.enum(["goat", "crescendo"]).nullish(),
  redTeamTarget: z.string().nullish(),
  redTeamTotalTurns: z.number().int().min(1).max(50).nullish(),
  redTeamConfig: z
    .object({
      successScore: z.number().min(0).max(10).optional(),
      successConfirmTurns: z.number().int().min(1).optional(),
      injectionProbability: z.number().min(0).max(1).optional(),
    })
    .nullish(),
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
  formRef?: (form: UseFormReturn<ScenarioFormData>) => void;
  /** Show the Standard / Red team selector. */
  showTypeSelector?: boolean;
  /** Reports whether this is currently a red-team scenario, so the drawer
   *  can mark itself. Fires on toggle, not only on load. */
  onIsRedTeamChange?: (isRedTeam: boolean) => void;
};

/**
 * Standard vs red team. Switching to red team reveals the attack section
 * below rather than opening a second panel over this one.
 */
function ScenarioTypeSelector({
  isRedTeam,
  onSelect,
}: {
  isRedTeam: boolean;
  onSelect: (redTeam: boolean) => void;
}) {
  return (
    <VStack align="stretch" gap={2}>
      <SectionHeader>Type</SectionHeader>
      <HStack gap={2}>
        <Button
          size="sm"
          variant={isRedTeam ? "outline" : "solid"}
          onClick={() => onSelect(false)}
          flex={1}
        >
          Standard
        </Button>
        <Button
          size="sm"
          variant={isRedTeam ? "solid" : "outline"}
          colorPalette={isRedTeam ? "redteam" : undefined}
          onClick={() => onSelect(true)}
          flex={1}
        >
          <ShieldAlert size={14} /> Red team
        </Button>
      </HStack>
    </VStack>
  );
}

/**
 * Pure UI form for creating/editing scenarios.
 * Matches the design mockup layout.
 * Submit is handled externally via formRef.
 */
export function ScenarioForm({
  defaultValues,
  formRef,
  showTypeSelector = true,
  onIsRedTeamChange,
}: ScenarioFormProps) {
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

  // useWatch, not form.watch: this component receives `form` from its own
  // useForm here, but the same rule applies for re-render correctness inside
  // the nested selector.
  const redTeamStrategy = useWatch({ control, name: "redTeamStrategy" });
  const isRedTeam = !!redTeamStrategy;

  const handleTypeSelect = (redTeam: boolean) => {
    if (redTeam) {
      // Default to Crescendo — the SDK's own recommended starting strategy —
      // so the section opens usable rather than empty.
      if (!redTeamStrategy) form.setValue("redTeamStrategy", "crescendo");
      if (!form.getValues("redTeamTotalTurns")) {
        form.setValue("redTeamTotalTurns", RED_TEAM_DEFAULT_TURNS);
      }
      return;
    }
    form.setValue("redTeamStrategy", null);
    form.setValue("redTeamTarget", null);
    form.setValue("redTeamTotalTurns", null);
    form.setValue("redTeamConfig", null);
  };

  // Expose form to parent
  useEffect(() => {
    formRef?.(form);
  }, [form, formRef]);

  useEffect(() => {
    onIsRedTeamChange?.(isRedTeam);
  }, [isRedTeam, onIsRedTeamChange]);

  // Reset form when defaultValues change (using ref to track previous serialized values)
  const prevDefaultsRef = useRef<string | null>(null);
  useEffect(() => {
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
  }, [defaultValues, reset]);

  return (
    <VStack align="stretch" gap={6}>
      {/* TYPE Section — a red-team scenario is still a scenario; only who
          drives the conversation changes, so this is a mode on the same form
          rather than a separate creation flow. */}
      {showTypeSelector && (
        <ScenarioTypeSelector isRedTeam={isRedTeam} onSelect={handleTypeSelect} />
      )}

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

      {isRedTeam && <RedTeamAttackSection form={form} />}

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
