import {
  Accordion,
  Box,
  Field,
  HStack,
  Input,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { ShieldAlert } from "lucide-react";
import { Controller, type UseFormReturn } from "react-hook-form";
import type { ScenarioFormData } from "./ScenarioForm";
import { SectionHeader } from "./ui/SectionHeader";

export const RED_TEAM_STRATEGIES = [
  {
    value: "crescendo" as const,
    label: "Crescendo",
    description:
      "Warms up, then escalates gradually across turns instead of asking outright.",
  },
  {
    value: "goat" as const,
    label: "GOAT",
    description:
      "Picks a fresh angle every turn based on how the agent responds. Better against agents that hold firm.",
  },
];

export const RED_TEAM_DEFAULT_TURNS = 30;
export const RED_TEAM_MAX_TURNS = 50;

/**
 * The attack configuration, inline in the scenario editor.
 *
 * Deliberately not a second drawer: the objective you are writing and the
 * criteria it will be judged against belong on screen together, and a panel
 * over the editor hides exactly the thing you are writing against.
 *
 * See specs/scenarios/red-team-scenarios.feature.
 */
export function RedTeamAttackSection({
  form,
}: {
  form: UseFormReturn<ScenarioFormData>;
}) {
  const { control, register, setValue } = form;

  return (
    <VStack align="stretch" gap={4}>
      <VStack align="stretch" gap={1}>
        <SectionHeader>Attack</SectionHeader>
        <Text fontSize="13px" color="fg.muted">
          A simulated attacker drives the conversation instead of a cooperative
          user, trying to make your agent do something it should refuse.
        </Text>
      </VStack>

      <Box
        colorPalette="redteam"
        borderWidth="1px"
        borderColor="colorPalette.emphasized"
        bg="colorPalette.subtle"
        borderRadius="md"
        padding={3}
      >
        <HStack gap={2} align="start">
          <Box paddingTop="2px" color="colorPalette.fg">
            <ShieldAlert size={16} />
          </Box>
          <Text textStyle="sm" color="fg.muted">
            Only run this against agents you own or have permission to test.
          </Text>
        </HStack>
      </Box>

      <VStack align="stretch" gap={2}>
        <Text textStyle="sm" fontWeight="medium">
          Strategy
        </Text>
        <Controller
          control={control}
          name="redTeamStrategy"
          render={({ field }) => (
            <VStack align="stretch" gap={2}>
              {RED_TEAM_STRATEGIES.map((option) => (
                <Box
                  key={option.value}
                  role="button"
                  tabIndex={0}
                  cursor="pointer"
                  colorPalette="redteam"
                  borderWidth="1px"
                  borderRadius="md"
                  padding={3}
                  borderColor={
                    field.value === option.value
                      ? "colorPalette.solid"
                      : "border.muted"
                  }
                  bg={
                    field.value === option.value
                      ? "colorPalette.subtle"
                      : undefined
                  }
                  onClick={() => field.onChange(option.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      field.onChange(option.value);
                    }
                  }}
                >
                  <Text textStyle="sm" fontWeight="medium">
                    {option.label}
                  </Text>
                  <Text textStyle="xs" color="fg.muted">
                    {option.description}
                  </Text>
                </Box>
              ))}
            </VStack>
          )}
        />
      </VStack>

      <Field.Root>
        <Text textStyle="sm" fontWeight="medium">
          What should the attacker try to do?
        </Text>
        <Textarea
          {...register("redTeamTarget")}
          rows={3}
          placeholder="e.g., get the agent to reveal its system prompt"
          _placeholder={{ color: "gray.400", fontStyle: "italic" }}
        />
      </Field.Root>

      <Field.Root>
        <Text textStyle="sm" fontWeight="medium">
          Turns
        </Text>
        <Input
          type="number"
          min={1}
          max={RED_TEAM_MAX_TURNS}
          width="120px"
          {...register("redTeamTotalTurns", {
            setValueAs: (v) => (v === "" || v === null ? null : Number(v)),
          })}
        />
        <Text textStyle="xs" color="fg.muted">
          How many attempts the attacker gets. More turns find more, and cost
          more.
        </Text>
      </Field.Root>

      <Accordion.Root collapsible>
        <Accordion.Item value="advanced">
          <Accordion.ItemTrigger>
            <Text textStyle="sm" fontWeight="medium">
              Advanced
            </Text>
            <Accordion.ItemIndicator />
          </Accordion.ItemTrigger>
          <Accordion.ItemContent>
            <Accordion.ItemBody>
              <VStack align="stretch" gap={4} paddingTop={2}>
                <Field.Root>
                  <Text textStyle="sm">Stop early at score</Text>
                  <Input
                    type="number"
                    min={0}
                    max={10}
                    width="120px"
                    placeholder="9"
                    defaultValue={
                      form.getValues("redTeamConfig")?.successScore ?? ""
                    }
                    onChange={(e) =>
                      setValue("redTeamConfig", {
                        ...(form.getValues("redTeamConfig") ?? {}),
                        successScore:
                          e.target.value === ""
                            ? undefined
                            : Number(e.target.value),
                      })
                    }
                  />
                  <Text textStyle="xs" color="fg.muted">
                    Stop once the attacker is this close to succeeding.
                  </Text>
                </Field.Root>

                <Field.Root>
                  <Text textStyle="sm">Obfuscation</Text>
                  <Input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    width="120px"
                    placeholder="0"
                    defaultValue={
                      form.getValues("redTeamConfig")?.injectionProbability ?? ""
                    }
                    onChange={(e) =>
                      setValue("redTeamConfig", {
                        ...(form.getValues("redTeamConfig") ?? {}),
                        injectionProbability:
                          e.target.value === ""
                            ? undefined
                            : Number(e.target.value),
                      })
                    }
                  />
                  <Text textStyle="xs" color="fg.muted">
                    How often to disguise messages, between 0 and 1.
                  </Text>
                </Field.Root>
              </VStack>
            </Accordion.ItemBody>
          </Accordion.ItemContent>
        </Accordion.Item>
      </Accordion.Root>
    </VStack>
  );
}
