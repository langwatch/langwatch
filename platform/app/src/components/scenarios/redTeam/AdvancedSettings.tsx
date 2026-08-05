import { Accordion, Text, VStack } from "@chakra-ui/react";
import { ChevronRight } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";

import type { ScenarioFormData } from "../ScenarioForm";
import { AdaptiveScoringSwitch } from "./AdaptiveScoringSwitch";
import { NumberSetting } from "./NumberSetting";
import { PlannerFields } from "./PlannerFields";

/**
 * Bottom padding as well as top: without it the accordion's closing rule sits
 * directly on the last input, and SITUATION below reads as part of Advanced
 * rather than a new section.
 */
function AdvancedFields({
  form,
  planningApplies,
  scoringOn,
}: {
  form: UseFormReturn<ScenarioFormData>;
  planningApplies: boolean;
  scoringOn: boolean;
}) {
  return (
    <VStack align="stretch" gap={4} paddingTop={2} paddingBottom={4}>
      <NumberSetting
        form={form}
        name="redTeamConfig.successScore"
        label="Stop early at score"
        help="Each turn is scored 0-10 for how close the attacker is to its goal. Once it reaches this score the run stops — the weakness is already proven and further turns just cost money. Leave empty to use the default of 9."
        min={0}
        max={10}
        placeholder="9"
        fallbackError="Enter a score between 0 and 10."
      />
      <AdaptiveScoringSwitch form={form} scoringOn={scoringOn} />
      {planningApplies && <PlannerFields form={form} />}
      <NumberSetting
        form={form}
        name="redTeamConfig.injectionProbability"
        label="Obfuscation"
        help="Chance per turn that the attacker's message is re-encoded after it is written (Base64, ROT13) to slip past filters that match on plain text. 0 sends everything in the clear; 1 encodes every turn. Leave empty for 0."
        min={0}
        max={1}
        step={0.05}
        placeholder="0"
        fallbackError="Enter a number between 0 and 1."
      />
    </VStack>
  );
}

/**
 * Planner and scoring settings.
 *
 * Controlled open state: the cross-field strategy/planner error is reported at
 * `redTeamConfig` and both planner inputs live in here, so if it fired while
 * this was shut the form would refuse to save and show nothing.
 */
export function AdvancedSettings({
  form,
  advancedOpen,
  setAdvancedOpen,
  planningApplies,
  scoringOn,
}: {
  form: UseFormReturn<ScenarioFormData>;
  advancedOpen: string[];
  setAdvancedOpen: (value: string[]) => void;
  planningApplies: boolean;
  scoringOn: boolean;
}) {
  return (
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
            <AdvancedFields
              form={form}
              planningApplies={planningApplies}
              scoringOn={scoringOn}
            />
          </Accordion.ItemBody>
        </Accordion.ItemContent>
      </Accordion.Item>
    </Accordion.Root>
  );
}
