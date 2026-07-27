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
import { HelpCircle } from "lucide-react";
import { Controller, type UseFormReturn } from "react-hook-form";
import { Tooltip } from "../ui/tooltip";
import type { ScenarioFormData } from "./ScenarioForm";
import { SectionHeader } from "./ui/SectionHeader";

export const RED_TEAM_STRATEGIES = [
  {
    value: "crescendo" as const,
    label: "Crescendo",
    description: "Warms up, then escalates gradually across turns.",
    help: "Opens with harmless questions and escalates a little each turn, so the agent is asked for something slightly worse than it just agreed to. Good default: it finds agents that hold on a direct ask but drift under gradual pressure.",
  },
  {
    value: "goat" as const,
    label: "GOAT",
    description: "Picks a fresh angle every turn.",
    help: "Chooses a different technique each turn based on how the agent replied — roleplay, hypotheticals, authority, splitting the request. Better against agents that hold firm against a single escalating line, and costs more because it reasons about each turn.",
  },
];

export const RED_TEAM_DEFAULT_TURNS = 30;
export const RED_TEAM_MAX_TURNS = 50;

const ATTACK_HELP =
  "A simulated attacker drives the conversation instead of a cooperative user, trying to make your agent do something it should refuse. The criteria below are what it must fail to achieve — they are how the run is judged. Only run this against agents you own or have permission to test.";

/** Label with an (i) that carries the full explanation, per copywriting.md. */
function LabelWithHelp({ label, help }: { label: string; help: string }) {
  return (
    <HStack gap={1.5} align="center">
      <Text textStyle="sm" fontWeight="medium">
        {label}
      </Text>
      <Tooltip content={help}>
        <Box color="fg.muted" display="flex" cursor="pointer">
          <HelpCircle size={13} />
        </Box>
      </Tooltip>
    </HStack>
  );
}

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
  const { control, register, setValue, getValues } = form;

  return (
    <VStack align="stretch" gap={4}>
      <HStack gap={1.5} align="center">
        <SectionHeader>Attack</SectionHeader>
        <Tooltip content={ATTACK_HELP}>
          <Box color="fg.muted" display="flex" cursor="pointer" paddingBottom="2px">
            <HelpCircle size={13} />
          </Box>
        </Tooltip>
      </HStack>

      <VStack align="stretch" gap={2}>
        <Text textStyle="sm" fontWeight="medium">
          Strategy
        </Text>
        <Controller
          control={control}
          name="redTeamStrategy"
          render={({ field }) => (
            <VStack align="stretch" gap={2}>
              {RED_TEAM_STRATEGIES.map((option) => {
                const selected = field.value === option.value;
                return (
                  <Box
                    key={option.value}
                    role="button"
                    tabIndex={0}
                    cursor="pointer"
                    colorPalette="redteam"
                    borderWidth="1px"
                    borderRadius="md"
                    paddingX={3}
                    paddingY={2.5}
                    borderColor={selected ? "colorPalette.solid" : "border.muted"}
                    // Ring only — the fill made the whole card read as an
                    // alert. Selection should outline the choice, not repaint it.
                    boxShadow={
                      selected ? "0 0 0 3px var(--chakra-colors-color-palette-subtle)" : undefined
                    }
                    transition="border-color 120ms ease, box-shadow 120ms ease"
                    onClick={() => field.onChange(option.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        field.onChange(option.value);
                      }
                    }}
                  >
                    <HStack gap={1.5} align="center" minWidth={0}>
                      <Text textStyle="sm" fontWeight="medium" flexShrink={0}>
                        {option.label}
                      </Text>
                      <Text textStyle="xs" color="fg.muted" truncate>
                        {option.description}
                      </Text>
                      <Tooltip content={option.help}>
                        <Box
                          color="fg.muted"
                          display="flex"
                          cursor="pointer"
                          flexShrink={0}
                          marginStart="auto"
                        >
                          <HelpCircle size={13} />
                        </Box>
                      </Tooltip>
                    </HStack>
                  </Box>
                );
              })}
            </VStack>
          )}
        />
      </VStack>

      <Field.Root>
        <LabelWithHelp
          label="What should the attacker try to do?"
          help="The goal the attacker works toward, in plain words. Be concrete — 'reveal the internal override code' gives it something to aim at, 'be bad' does not."
        />
        <Textarea
          {...register("redTeamTarget")}
          rows={3}
          placeholder="e.g., get the agent to reveal its system prompt"
          _placeholder={{ color: "gray.400", fontStyle: "italic" }}
        />
      </Field.Root>

      <Field.Root>
        <LabelWithHelp
          label="Turns"
          help={`How many attempts the attacker gets. More turns find more, and cost more — every turn is a model call on both sides. Up to ${RED_TEAM_MAX_TURNS}.`}
        />
        <Input
          type="number"
          min={1}
          max={RED_TEAM_MAX_TURNS}
          width="120px"
          {...register("redTeamTotalTurns", {
            setValueAs: (v) => (v === "" || v === null ? null : Number(v)),
          })}
        />
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
                  <LabelWithHelp
                    label="Stop early at score"
                    help="Each turn is scored 0-10 for how close the attacker is to its goal. Once it reaches this score the run stops — the weakness is already proven and further turns just cost money. Leave empty to use the default of 9."
                  />
                  <Input
                    type="number"
                    min={0}
                    max={10}
                    width="120px"
                    placeholder="9"
                    defaultValue={getValues("redTeamConfig")?.successScore ?? ""}
                    onChange={(e) =>
                      setValue("redTeamConfig", {
                        ...(getValues("redTeamConfig") ?? {}),
                        successScore:
                          e.target.value === ""
                            ? undefined
                            : Number(e.target.value),
                      })
                    }
                  />
                </Field.Root>

                <Field.Root>
                  <LabelWithHelp
                    label="Obfuscation"
                    help="Chance per turn that the attacker disguises its message (base64, leetspeak, splitting words) to slip past filters that match on plain text. 0 sends everything in the clear; 1 disguises every turn. Leave empty for 0."
                  />
                  <Input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    width="120px"
                    placeholder="0"
                    defaultValue={
                      getValues("redTeamConfig")?.injectionProbability ?? ""
                    }
                    onChange={(e) =>
                      setValue("redTeamConfig", {
                        ...(getValues("redTeamConfig") ?? {}),
                        injectionProbability:
                          e.target.value === ""
                            ? undefined
                            : Number(e.target.value),
                      })
                    }
                  />
                </Field.Root>
              </VStack>
            </Accordion.ItemBody>
          </Accordion.ItemContent>
        </Accordion.Item>
      </Accordion.Root>
    </VStack>
  );
}
