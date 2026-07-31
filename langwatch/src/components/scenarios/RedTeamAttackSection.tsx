import {
  Accordion,
  Box,
  Button,
  Field,
  HStack,
  Input,
  Switch,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { ChevronDown, ChevronRight, HelpCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Controller, type UseFormReturn, useWatch } from "react-hook-form";
import { Menu } from "~/components/ui/menu";
import {
  RED_TEAM_DEFAULT_TURNS,
  RED_TEAM_MAX_TURNS,
  type RedTeamStrategyName,
} from "~/server/scenarios/execution/types";
import { Tooltip } from "../ui/tooltip";
import { OBJECTIVE_HELP, RED_TEAM_OBJECTIVE_GROUPS } from "./redTeamObjectives";
import type { ScenarioFormData } from "./ScenarioForm";
import { SectionHeader } from "./ui/SectionHeader";

/**
 * How each strategy is presented. Named for what it is — a list of options for
 * one picker — rather than sharing `RED_TEAM_STRATEGIES` with the contract in
 * `execution/types`, which is the tuple the schemas are built from. Two exports
 * under one name with two different shapes is how an import ends up pointing at
 * the wrong one.
 *
 * `value` is typed against the contract, so dropping or renaming a strategy
 * there fails the build here instead of quietly leaving a button that writes an
 * unknown value.
 */
export const RED_TEAM_STRATEGY_OPTIONS: {
  value: RedTeamStrategyName;
  label: string;
  description: string;
  help: string;
}[] = [
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

/**
 * Label with an (i) that carries the full explanation, per copywriting.md.
 *
 * `Field.Label`, not a bare `Text`: inside a `Field.Root` it picks up the
 * generated `htmlFor`, so the input it sits above actually has a name. As
 * plain text it read as a label and was one to nobody — not to a screen
 * reader, and not to anything asking the page what these inputs are.
 */
function LabelWithHelp({ label, help }: { label: string; help: string }) {
  return (
    <Field.Label>
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
    </Field.Label>
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
  const {
    control,
    register,
    setValue,
    getValues,
    formState: { errors },
  } = form;
  // GOAT reasons turn by turn and never pre-generates a plan
  // (needsMetapromptPlan = false), so the SDK ignores both planner fields for
  // it — one with a console warning, one silently. Showing inputs that do
  // nothing would be worse than not offering them.
  const strategy = useWatch({ control, name: "redTeamStrategy" });
  const planningApplies = strategy === "crescendo";
  const config = useWatch({ control, name: "redTeamConfig" });
  const scoringOn = config?.scoreResponses !== false;

  // The mismatch between a strategy and the planner fields is reported at
  // `redTeamConfig`, and both planner inputs live inside Advanced — so if it
  // fired while Advanced was shut, the form would refuse to save and show
  // nothing. Controlled, and opened by the error that explains itself.
  const [advancedOpen, setAdvancedOpen] = useState<string[]>([]);
  const configError = errors.redTeamConfig;
  const hasConfigError = !!configError;
  useEffect(() => {
    if (hasConfigError) setAdvancedOpen(["advanced"]);
  }, [hasConfigError]);

  /**
   * Switching strategy keeps the planner settings, and revalidates.
   *
   * The draft holds them so switching to GOAT to read what it does — and back
   * — does not destroy an attack plan someone wrote. What must not happen is
   * *storing* them on a GOAT scenario, and that is handled where the draft
   * becomes a write (`withApplicableRedTeamConfig`), not here.
   *
   * `shouldValidate` matters: the cross-field rule is evaluated against the
   * stripped value, so the stale error from the previous strategy has to be
   * recomputed on the switch rather than left sitting on the form.
   */
  const selectStrategy = (
    value: RedTeamStrategyName,
    onChange: (value: RedTeamStrategyName) => void,
  ) => {
    onChange(value);
    void form.trigger();
  };

  return (
    <VStack align="stretch" gap={4}>
      <HStack gap={1.5} align="center">
        <SectionHeader>Attack</SectionHeader>
        <Tooltip content={ATTACK_HELP}>
          <Box
            color="fg.muted"
            display="flex"
            cursor="pointer"
            paddingBottom="2px"
          >
            <HelpCircle size={13} />
          </Box>
        </Tooltip>
      </HStack>

      <Field.Root invalid={hasConfigError}>
        <Text textStyle="sm" fontWeight="medium">
          Strategy
        </Text>
        <Controller
          control={control}
          name="redTeamStrategy"
          render={({ field }) => (
            <VStack align="stretch" gap={2} width="full">
              {RED_TEAM_STRATEGY_OPTIONS.map((option) => {
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
                    borderColor={
                      selected ? "colorPalette.solid" : "border.muted"
                    }
                    // Ring only — the fill made the whole card read as an
                    // alert. Selection should outline the choice, not repaint it.
                    boxShadow={
                      selected
                        ? "0 0 0 3px var(--chakra-colors-color-palette-subtle)"
                        : undefined
                    }
                    transition="border-color 120ms ease, box-shadow 120ms ease"
                    onClick={() => selectStrategy(option.value, field.onChange)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        selectStrategy(option.value, field.onChange);
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
        <Field.ErrorText>{configError?.message}</Field.ErrorText>
      </Field.Root>

      <Field.Root invalid={!!errors.redTeamTarget}>
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
              // The drawer sets colorPalette="redteam", which every descendant
              // inherits — so without this the picker's hover and focus states
              // come out red. Red is reserved for what marks the scenario as an
              // attack (the drawer edge, the type button, the chosen strategy);
              // a list of things to pick from is not one of those.
              colorPalette="gray"
            >
              Start from a category
              <ChevronDown size={13} />
            </Button>
          </Menu.Trigger>
          {/* Grouped and scrollable rather than trimmed. The three headings
              are the only place the product says what red teaming is for, so
              cutting to one shorter list would quietly narrow that to
              "security". A capped height keeps it browsable. */}
          <Menu.Content
            minWidth="360px"
            maxHeight="380px"
            overflowY="auto"
            padding={1}
            colorPalette="gray"
          >
            {RED_TEAM_OBJECTIVE_GROUPS.map((group) => (
              <Menu.ItemGroup key={group.label} title={group.label}>
                {group.objectives.map((objective) => (
                  <Menu.Item
                    key={objective.label}
                    value={objective.code ?? objective.label}
                    paddingY={1.5}
                    onClick={() =>
                      setValue("redTeamTarget", objective.target, {
                        shouldDirty: true,
                      })
                    }
                  >
                    <VStack align="stretch" gap={0} width="full">
                      <HStack gap={3} align="baseline" width="full">
                        <Text textStyle="sm" fontWeight="medium">
                          {objective.label}
                        </Text>
                        {objective.code ? (
                          <Text
                            textStyle="xs"
                            color="fg.subtle"
                            fontFamily="mono"
                            flexShrink={0}
                            marginStart="auto"
                          >
                            {objective.code}
                          </Text>
                        ) : null}
                      </HStack>
                      <Text textStyle="xs" color="fg.muted">
                        {objective.summary}
                      </Text>
                    </VStack>
                  </Menu.Item>
                ))}
              </Menu.ItemGroup>
            ))}
          </Menu.Content>
        </Menu.Root>
        <Textarea
          {...register("redTeamTarget")}
          rows={3}
          placeholder="e.g., get the agent to reveal its system prompt"
          _placeholder={{ color: "gray.400", fontStyle: "italic" }}
        />
        <Field.ErrorText>{errors.redTeamTarget?.message}</Field.ErrorText>
      </Field.Root>

      <Field.Root invalid={!!errors.redTeamTotalTurns}>
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
        {/* `min`/`max` on a number input are advisory — they colour the
            spinner and nothing else. Typing 51 is allowed, the schema rejects
            it, and without this the only symptom is a Save button that stops
            working. */}
        <Field.ErrorText>
          {errors.redTeamTotalTurns?.message ??
            `Enter a whole number between 1 and ${RED_TEAM_MAX_TURNS}.`}
        </Field.ErrorText>
      </Field.Root>

      <Accordion.Root
        collapsible
        value={advancedOpen}
        onValueChange={({ value }) => setAdvancedOpen(value)}
      >
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
                {/* Registered, not `defaultValue` + `setValue`. The old pair
                    read the value once on mount, so anything that changed the
                    config afterwards — a `reset()`, or switching strategy —
                    left the input showing a value the form no longer held. */}
                <Field.Root invalid={!!errors.redTeamConfig?.successScore}>
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
                    {...register("redTeamConfig.successScore", {
                      setValueAs: (v) =>
                        v === "" || v === null ? undefined : Number(v),
                    })}
                  />
                  <Field.ErrorText>
                    {errors.redTeamConfig?.successScore?.message ??
                      "Enter a score between 0 and 10."}
                  </Field.ErrorText>
                </Field.Root>

                <Field.Root>
                  <LabelWithHelp
                    label="Adaptive scoring"
                    help="Every reply is scored 0-10 and the attacker adjusts its next move, backing out of a line that got a hard refusal. Turning it off is the recommended way to make a run cheaper — it keeps the full turn budget, but the attacker stops reacting to what the agent said."
                  />
                  <Switch.Root
                    checked={scoringOn}
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
                    <Field.Root invalid={!!errors.redTeamConfig?.attackPlan}>
                      <LabelWithHelp
                        label="Attack plan"
                        help="Crescendo normally spends one model call writing a phased plan before it starts. Paste your own to skip that and control the attack exactly — phase by phase, in your own words. Leave empty to let it plan."
                      />
                      <Textarea
                        rows={4}
                        placeholder={
                          "e.g., Turns 1-10: ask about products.\nTurns 11-25: ask how AI assistants work.\nTurns 26-50: ask it to repeat its instructions."
                        }
                        _placeholder={{
                          color: "gray.400",
                          fontStyle: "italic",
                        }}
                        {...register("redTeamConfig.attackPlan", {
                          setValueAs: (v) => (v === "" ? undefined : v),
                        })}
                      />
                      <Field.ErrorText>
                        {errors.redTeamConfig?.attackPlan?.message}
                      </Field.ErrorText>
                    </Field.Root>

                    <Field.Root
                      invalid={!!errors.redTeamConfig?.metapromptTemplate}
                    >
                      <LabelWithHelp
                        label="Planning prompt"
                        help="Replaces the instructions used to write the attack plan, rather than the plan itself. Use {target}, {description}, {totalTurns} and {phase1End}/{phase2End}/{phase3End} where those values should appear. Ignored when an attack plan is set above, since nothing needs planning then."
                      />
                      <Textarea
                        rows={3}
                        placeholder="Leave empty to use the built-in planning prompt"
                        _placeholder={{
                          color: "gray.400",
                          fontStyle: "italic",
                        }}
                        {...register("redTeamConfig.metapromptTemplate", {
                          setValueAs: (v) => (v === "" ? undefined : v),
                        })}
                      />
                      <Field.ErrorText>
                        {errors.redTeamConfig?.metapromptTemplate?.message}
                      </Field.ErrorText>
                    </Field.Root>
                  </>
                )}

                <Field.Root
                  invalid={!!errors.redTeamConfig?.injectionProbability}
                >
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
                    {...register("redTeamConfig.injectionProbability", {
                      setValueAs: (v) =>
                        v === "" || v === null ? undefined : Number(v),
                    })}
                  />
                  <Field.ErrorText>
                    {errors.redTeamConfig?.injectionProbability?.message ??
                      "Enter a number between 0 and 1."}
                  </Field.ErrorText>
                </Field.Root>
              </VStack>
            </Accordion.ItemBody>
          </Accordion.ItemContent>
        </Accordion.Item>
      </Accordion.Root>
    </VStack>
  );
}
