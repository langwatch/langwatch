/**
 * Opens the evaluator editor drawer on one attachment of a suite or run
 * plan — the same drawer the evaluations workbench opens. Every edit writes
 * straight back through flow callbacks, so the chip follows as the person maps.
 */

import { setFlowCallbacks, useDrawer } from "@langwatch/browser-host/drawer";
import type { FieldMapping as UIFieldMapping } from "@langwatch/prompt-browser-kit";
import {
  type EvaluatorAttachment,
  type ScenarioMapping,
  type ScenarioMappingContext,
  scenarioMappingSchema,
  scenarioMappingSources,
} from "@langwatch/scenario-contract";
import { useCallback } from "react";

import {
  type AttachableEvaluator,
  evaluatorCanRequire,
  evaluatorTypeOf,
} from "../../../model/agent-testing/evaluators/attachment-rules.ts";

export type OpenScenarioEvaluatorEditorParams = {
  attachment: EvaluatorAttachment;
  evaluator: AttachableEvaluator;
  ctx: ScenarioMappingContext;
  /** True for a run plan, which offers no scenario field to map to. */
  isPlanLevel?: boolean;
  /**
   * How the editor joins the drawer stack. Replacing the current entry is
   * what a pick from the evaluator list asks for, so back from the editor
   * lands on the caller and not on the list.
   */
  navigation?: { replaceCurrentInStack?: boolean };
  onMappingChange: (change: { input: string; mapping: ScenarioMapping | undefined }) => void;
  onRequiredChange: (required: boolean) => void;
  onRemove: () => void;
};

/**
 * A mapping as the picker reports it, checked against the grammar the run
 * reads. The picker only offers sources it was handed, so a failure here is
 * a picker bug, not a person's mistake, and is dropped rather than stored.
 */
function toScenarioMapping(mapping: UIFieldMapping | undefined): ScenarioMapping | undefined {
  if (!mapping) return undefined;
  const parsed = scenarioMappingSchema.safeParse(mapping);
  return parsed.success ? parsed.data : undefined;
}

export function useOpenScenarioEvaluatorEditor(): (
  params: OpenScenarioEvaluatorEditorParams,
) => void {
  const { openDrawer } = useDrawer();

  return useCallback(
    ({
      attachment,
      evaluator,
      ctx,
      isPlanLevel,
      navigation,
      onMappingChange,
      onRequiredChange,
      onRemove,
    }: OpenScenarioEvaluatorEditorParams) => {
      const mappingsConfig = {
        availableSources: scenarioMappingSources({ ctx, isPlanLevel }),
        initialMappings: attachment.mappings,
      };
      const handleMappingChange = (input: string, mapping: UIFieldMapping | undefined) =>
        onMappingChange({ input, mapping: toScenarioMapping(mapping) });

      // A code evaluator has its own editor, which holds its inputs beside
      // the code; the generic editor could only show the mappings. It still
      // carries the same gate switch and remove action as any other
      // attachment.
      if (evaluator.type === "code") {
        setFlowCallbacks("codeEvaluatorEditor", {
          onMappingChange: handleMappingChange,
          onRequiredChange,
          onRemove,
        });
        openDrawer(
          "codeEvaluatorEditor",
          {
            evaluatorId: evaluator.id,
            mappingsConfig,
            gate: {
              required: attachment.required,
              canRequire: evaluatorCanRequire(evaluator),
            },
          },
          navigation,
        );
        return;
      }

      setFlowCallbacks("evaluatorEditor", {
        onMappingChange: handleMappingChange,
        onRequiredChange,
        onRemove,
      });
      openDrawer(
        "evaluatorEditor",
        {
          evaluatorId: evaluator.id,
          evaluatorType: evaluatorTypeOf(evaluator),
          mappingsConfig,
          gate: {
            required: attachment.required,
            canRequire: evaluatorCanRequire(evaluator),
          },
        },
        navigation,
      );
    },
    [openDrawer],
  );
}
