import { Box, Field, HStack, Text, VStack } from "@chakra-ui/react";
import { HelpCircle } from "lucide-react";
import { type Control, Controller } from "react-hook-form";

import type { RedTeamStrategyName } from "~/server/scenarios/execution/types";
import { Tooltip } from "../../ui/tooltip";
import type { ScenarioFormData } from "../ScenarioForm";
import { RED_TEAM_STRATEGY_OPTIONS } from "./strategies";

/** The strategy cards. Selection outlines the choice rather than repainting it. */
export function StrategyPicker({
  control,
  hasConfigError,
  configError,
  selectStrategy,
}: {
  control: Control<ScenarioFormData>;
  hasConfigError: boolean;
  configError?: { message?: string };
  selectStrategy: (
    value: RedTeamStrategyName,
    onChange: (value: RedTeamStrategyName) => void,
  ) => void;
}) {
  return (
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
                  borderColor={selected ? "colorPalette.solid" : "border.muted"}
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
  );
}
