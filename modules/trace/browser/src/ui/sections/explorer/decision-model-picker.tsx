/**
 * The decision model a refused Instant Eval runs on, picked in place with the same picker and the
 * same entries as Settings › Default models' Instant Evals column (ADR-182).
 * @see modules/instant-eval/specs/instant-eval-opt-in.feature
 */
import { Link as RoutedLink } from "@langwatch/browser-host/link";
import { Box, Button, Text } from "@langwatch/design-system/primitives";
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
        placeholder={DECISION_MODEL_PICKER_PLACEHOLDER}
        footer={<ConfigureModelsLink href={configureHref} />}
      />
    </Box>
  );
}

/** The foot of the dropdown, as in the evaluator's model picker: Model Providers in a new tab. */
function ConfigureModelsLink({ href }: { href: string }) {
  return (
    <Button
      asChild
      variant="ghost"
      colorPalette="gray"
      size="sm"
      width="full"
      justifyContent="flex-start"
      color="fg.muted"
      fontWeight="500"
    >
      <RoutedLink
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="decision-model-picker-configure"
        style={{ textDecoration: "none" }}
        onClick={(event) => event.stopPropagation()}
      >
        <SlidersHorizontal size={14} />
        <Text textStyle="body">Configure available models</Text>
      </RoutedLink>
    </Button>
  );
}
