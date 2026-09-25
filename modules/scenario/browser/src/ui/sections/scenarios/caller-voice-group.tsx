/**
 * The collapsed Caller voice group under Customize scenario: Voice, Interrupts
 * and Effects, used only when the scenario runs against a voice target (AC17).
 * @see specs/features/agents/voice-agents-v1.feature
 */
import { Collapsible, Field, HStack, NativeSelect, Text, VStack } from "@chakra-ui/react";
import { SimpleSlider } from "@langwatch/design-system/slider";
import { CALLER_VOICE_EFFECTS, type CallerVoiceConfig } from "@langwatch/scenario-contract";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { type Control, Controller } from "react-hook-form";

import { useVoiceAgentsEnabled } from "../../../behavior/use-voice-agents-enabled.ts";
import type { ScenarioFormData } from "../../elements/scenario-form.tsx";
import { ScenarioSectionHeader } from "../../elements/scenario-section-header.tsx";
import { CallerVoiceModelSelect } from "./caller-voice-model-select.tsx";

/** The words a person reads for each caller-voice effect. */
export const EFFECT_LABELS: Record<CallerVoiceConfig["effects"], string> = {
  none: "None",
  phone_line: "Phone line",
  background_noise: "Background noise",
};

export function CallerVoiceGroup({ control }: { control: Control<ScenarioFormData> }) {
  const [open, setOpen] = useState(false);
  const ChevronIcon = open ? ChevronDown : ChevronRight;
  const voiceAgentsEnabled = useVoiceAgentsEnabled();

  if (!voiceAgentsEnabled) return null;

  return (
    <Collapsible.Root
      open={open}
      onOpenChange={({ open }) => setOpen(open)}
      data-testid="caller-voice-group"
    >
      <Collapsible.Trigger asChild>
        <HStack cursor="pointer" userSelect="none" _hover={{ color: "fg.emphasized" }}>
          <ChevronIcon size={14} />
          <ScenarioSectionHeader>Caller voice</ScenarioSectionHeader>
        </HStack>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <VStack align="stretch" gap={4} pt={3}>
          <Text fontSize="12px" color="fg.muted">
            Used when this scenario runs against a voice agent.
          </Text>
          {/* The picker queries the project's providers, so it mounts only once opened. */}
          {open && (
            <Field.Root>
              <Text fontSize="13px" fontWeight="medium">
                Voice
              </Text>
              <Controller
                name="callerVoice.voiceModel"
                control={control}
                render={({ field }) => (
                  <CallerVoiceModelSelect
                    value={field.value ?? null}
                    onChange={field.onChange}
                    size="full"
                  />
                )}
              />
            </Field.Root>
          )}
          <Controller
            name="callerVoice.interruptProbability"
            control={control}
            render={({ field }) => {
              const percent = Math.round((field.value ?? 0) * 100);
              return (
                <Field.Root>
                  <Text fontSize="13px" fontWeight="medium">
                    Interrupts: {percent}%
                  </Text>
                  <SimpleSlider
                    size="sm"
                    min={0}
                    max={100}
                    step={5}
                    aria-label={["Interrupts"]}
                    value={[percent]}
                    onValueChange={({ value }) => field.onChange((value[0] ?? 0) / 100)}
                  />
                </Field.Root>
              );
            }}
          />
          <Field.Root>
            <Text fontSize="13px" fontWeight="medium">
              Effects
            </Text>
            <Controller
              name="callerVoice.effects"
              control={control}
              render={({ field }) => (
                <NativeSelect.Root size="sm">
                  <NativeSelect.Field
                    aria-label="Effects"
                    value={field.value ?? "none"}
                    onChange={(event) => field.onChange(event.target.value)}
                  >
                    {CALLER_VOICE_EFFECTS.map((effect) => (
                      <option key={effect} value={effect}>
                        {EFFECT_LABELS[effect]}
                      </option>
                    ))}
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              )}
            />
          </Field.Root>
        </VStack>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
