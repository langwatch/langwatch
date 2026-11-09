/**
 * The decision model a refused Instant Eval runs on, picked in place with the same picker and the
 * same entries as Settings › Default models' Instant Evals column (ADR-182).
 * @see modules/instant-eval/specs/instant-eval-opt-in.feature
 */
import { Link as RoutedLink } from "@langwatch/browser-host/link";
import { Box, HStack, Text } from "@langwatch/design-system/primitives";
import { ProviderModelSelector } from "@langwatch/design-system/provider-model-selector";
import { ownDecisionModelPickerOptions } from "@langwatch/model-provider-contract";
import { SlidersHorizontal } from "lucide-react";

/** What the trigger reads before a model is picked. */
export const DECISION_MODEL_PICKER_PLACEHOLDER = "Choose a decision model";

export function DecisionModelPicker({
  pickable,
  onPick,
  picking,
  configureHref,
}: {
  /** The server's answer; undefined while it loads. */
  pickable: readonly { value: string; label: string }[] | undefined;
  onPick: (model: string) => void;
  /** The model being saved, so the trigger shows it and waits. */
  picking: string | null;
  configureHref: string;
}) {
  return (
    <Box data-testid="decision-model-picker">
      <ProviderModelSelector
        model={picking ?? ""}
        query={{
          data: pickable ? ownDecisionModelPickerOptions(pickable) : undefined,
          isLoading: !pickable,
        }}
        onChange={onPick}
        size="full"
        disabled={picking !== null}
        labelFor={(id) => id || DECISION_MODEL_PICKER_PLACEHOLDER}
      />
      <RoutedLink
        href={configureHref}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="decision-model-picker-configure"
        style={{ textDecoration: "none" }}
      >
        <HStack gap={1.5} paddingTop={2} color="fg.muted" _hover={{ color: "fg" }}>
          <SlidersHorizontal size={12} />
          <Text textStyle="2xs" fontWeight="500">
            Configure available models
          </Text>
        </HStack>
      </RoutedLink>
    </Box>
  );
}
