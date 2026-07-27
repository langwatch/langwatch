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
  /** Opens the attack configuration. Omit to hide the type selector entirely. */
  onConfigureRedTeam?: () => void;
  /** Clears the attack configuration, returning to a standard scenario. */
  onClearRedTeam?: () => void;
};

/**
 * Standard vs red team. Picking "Red team" opens the attack configuration
 * straight away, because a red-team scenario without an objective has nothing
 * to run.
 */
function ScenarioTypeSelector({
  isRedTeam,
  onSelectStandard,
  onSelectRedTeam,
  summary,
}: {
  isRedTeam: boolean;
  onSelectStandard?: () => void;
  onSelectRedTeam: () => void;
  summary: string | null;
}) {
  return (
    <VStack align="stretch" gap={2}>
      <SectionHeader>Type</SectionHeader>
      <HStack gap={2}>
        <Button
          size="sm"
          variant={isRedTeam ? "outline" : "solid"}
          onClick={onSelectStandard}
          flex={1}
        >
          Standard
        </Button>
        <Button
          size="sm"
          variant={isRedTeam ? "solid" : "outline"}
          colorPalette={isRedTeam ? "redteam" : undefined}
          onClick={onSelectRedTeam}
          flex={1}
        >
          <ShieldAlert size={14} /> Red team
        </Button>
      </HStack>
      {isRedTeam && (
        <HStack justify="space-between" gap={2}>
          <Text textStyle="xs" color="fg.muted" truncate>
            {summary ?? "No attack configured yet"}
          </Text>
          <Button size="xs" variant="ghost" onClick={onSelectRedTeam}>
            Edit attack
          </Button>
        </HStack>
      )}
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
  onConfigureRedTeam,
  onClearRedTeam,
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
  const redTeamTarget = useWatch({ control, name: "redTeamTarget" });
  const redTeamTotalTurns = useWatch({ control, name: "redTeamTotalTurns" });

  const redTeamSummary = redTeamStrategy
    ? [
        redTeamStrategy === "goat" ? "GOAT" : "Crescendo",
        redTeamTotalTurns ? `${redTeamTotalTurns} turns` : null,
        redTeamTarget ? `"${redTeamTarget}"` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  // Expose form to parent
  useEffect(() => {
    formRef?.(form);
  }, [form, formRef]);

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
      {onConfigureRedTeam && (
        <ScenarioTypeSelector
          isRedTeam={!!redTeamStrategy}
          onSelectStandard={onClearRedTeam}
          onSelectRedTeam={onConfigureRedTeam}
          summary={redTeamSummary}
        />
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
