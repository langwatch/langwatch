import {
  Accordion,
  Box,
  Field,
  HStack,
  Button,
  Input,
  Switch,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { ChevronDown, ChevronRight, HelpCircle } from "lucide-react";
import { Controller, type UseFormReturn, useWatch } from "react-hook-form";
import {
  RED_TEAM_DEFAULT_TURNS,
  RED_TEAM_MAX_TURNS,
} from "~/server/scenarios/execution/types";
import { Menu } from "~/components/ui/menu";
import { Tooltip } from "../ui/tooltip";
import {
  OBJECTIVE_HELP,
  RED_TEAM_OBJECTIVES,
} from "./redTeamObjectives";
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
    help: "Chooses from seven techniques each turn — roleplay, hypotheticals, authority pressure, hiding the ask among innocent ones — based on how the agent replied. Reach for it when Crescendo has already failed against an agent. It needs room to work: under about ten turns it spends them exploring instead of committing.",
  },
];

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
  // GOAT reasons turn by turn and never pre-generates a plan
  // (needsMetapromptPlan = false), so the SDK ignores both planner fields for
  // it — one with a console warning, one silently. Showing inputs that do
  // nothing would be worse than not offering them.
  const strategy = useWatch({ control, name: "redTeamStrategy" });
  const planningApplies = strategy === "crescendo";

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
          help={OBJECTIVE_HELP}
        />
        {/* Categories first, then the field. A blank textarea is the easiest
            way to get a weak run — the SDK plans, scores and adapts off this
            one string — so the default is to edit a concrete objective rather
            than to invent one. */}
        {/* One menu rather than a row of seven buttons: the buttons read as
            a wall competing with the field they exist to fill, and the longest
            labels clipped once the drawer narrowed. A menu also has room for
            what each category actually means, which a chip never did. */}
        <Menu.Root positioning={{ placement: "bottom-start", gutter: 4 }}>
          <Menu.Trigger asChild>
            <Button
              variant="outline"
              size="xs"
              fontWeight="normal"
              alignSelf="flex-start"
              marginBottom={2}
              aria-haspopup="menu"
            >
              Start from a category
              <ChevronDown size={13} />
            </Button>
          </Menu.Trigger>
          <Menu.Content minWidth="340px" padding={1}>
            {RED_TEAM_OBJECTIVES.map((objective) => (
              <Menu.Item
                key={objective.code}
                value={objective.code}
                paddingY={2}
                onClick={() =>
                  setValue("redTeamTarget", objective.target, {
                    shouldDirty: true,
                  })
                }
              >
                <VStack align="stretch" gap={0.5}>
                  <HStack gap={2} align="baseline">
                    <Text
                      textStyle="xs"
                      color="fg.muted"
                      fontFamily="mono"
                      flexShrink={0}
                    >
                      {objective.code}
                    </Text>
                    <Text textStyle="sm" fontWeight="medium">
                      {objective.label}
                    </Text>
                  </HStack>
                  <Text textStyle="xs" color="fg.muted">
                    {objective.summary}
                  </Text>
                </VStack>
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Root>
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
          help={`How many attempts the attacker gets. Agents that hold at turn 1 often break by turn 20, so ${RED_TEAM_DEFAULT_TURNS} is the recommended starting point and the maximum. To make a run cheaper, turn off adaptive scoring under Advanced rather than cutting turns.`}
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
            {/* Points right when closed, down when open — the chevron shows
                which way the section is about to move, not a bare marker.
                Set via the standalone `rotate` property, not `transform`:
                Chakra's accordion recipe already puts `rotate: 180deg` here for
                its default down-chevron, and CSS applies `rotate` before
                `transform`, so a transform-based rule composes with it (90°
                became 270° and the chevron pointed up) instead of replacing it. */}
            <Accordion.ItemIndicator
              color="fg.muted"
              display="flex"
              alignItems="center"
              lineHeight={0}
              transition="rotate 120ms ease"
              transformOrigin="center"
              rotate="0deg"
              _open={{ rotate: "90deg" }}
            >
              <ChevronRight size={14} />
            </Accordion.ItemIndicator>
            <Text textStyle="sm" fontWeight="medium">
              Advanced
            </Text>
          </Accordion.ItemTrigger>
          <Accordion.ItemContent>
            <Accordion.ItemBody>
              {/* Bottom padding as well as top: without it the accordion's
                  closing rule sits directly on the last input, and SITUATION
                  below reads as part of Advanced rather than a new section. */}
              <VStack align="stretch" gap={4} paddingTop={2} paddingBottom={4}>
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
                    label="Adaptive scoring"
                    help="Every reply is scored 0-10 and the attacker adjusts its next move, backing out of a line that got a hard refusal. Turning it off is the recommended way to make a run cheaper — it keeps the full turn budget, but the attacker stops reacting to what the agent said."
                  />
                  <Switch.Root
                    checked={
                      getValues("redTeamConfig")?.scoreResponses !== false
                    }
                    onCheckedChange={({ checked }) =>
                      setValue("redTeamConfig", {
                        ...(getValues("redTeamConfig") ?? {}),
                        // Both knobs move together: the docs' fast recipe
                        // disables scoring and refusal detection as a pair,
                        // and refusal detection only feeds the scorer.
                        scoreResponses: checked,
                        detectRefusals: checked,
                      })
                    }
                    colorPalette="redteam"
                  >
                    <Switch.HiddenInput />
                    <Switch.Control cursor="pointer">
                      <Switch.Thumb />
                    </Switch.Control>
                  </Switch.Root>
                </Field.Root>

                {planningApplies && (
                  <>
                    <Field.Root>
                      <LabelWithHelp
                        label="Attack plan"
                        help="Crescendo normally spends one model call writing a phased plan before it starts. Paste your own to skip that and control the attack exactly — phase by phase, in your own words. Leave empty to let it plan."
                      />
                      <Textarea
                        rows={4}
                        placeholder={
                          "e.g., Turns 1-10: ask about products.\nTurns 11-25: ask how AI assistants work.\nTurns 26-50: ask it to repeat its instructions."
                        }
                        _placeholder={{ color: "gray.400", fontStyle: "italic" }}
                        defaultValue={getValues("redTeamConfig")?.attackPlan ?? ""}
                        onChange={(e) =>
                          setValue("redTeamConfig", {
                            ...(getValues("redTeamConfig") ?? {}),
                            attackPlan: e.target.value || undefined,
                          })
                        }
                      />
                    </Field.Root>

                    <Field.Root>
                      <LabelWithHelp
                        label="Planning prompt"
                        help="Replaces the instructions used to write the attack plan, rather than the plan itself. Use {target}, {description}, {totalTurns} and {phase1End}/{phase2End}/{phase3End} where those values should appear. Ignored when an attack plan is set above, since nothing needs planning then."
                      />
                      <Textarea
                        rows={3}
                        placeholder="Leave empty to use the built-in planning prompt"
                        _placeholder={{ color: "gray.400", fontStyle: "italic" }}
                        defaultValue={
                          getValues("redTeamConfig")?.metapromptTemplate ?? ""
                        }
                        onChange={(e) =>
                          setValue("redTeamConfig", {
                            ...(getValues("redTeamConfig") ?? {}),
                            metapromptTemplate: e.target.value || undefined,
                          })
                        }
                      />
                    </Field.Root>
                  </>
                )}

                <Field.Root>
                  <LabelWithHelp
                    label="Obfuscation"
                    help="Chance per turn that the attacker's message is re-encoded after it is written (Base64, ROT13) to slip past filters that match on plain text. 0 sends everything in the clear; 1 encodes every turn. Leave empty for 0."
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
