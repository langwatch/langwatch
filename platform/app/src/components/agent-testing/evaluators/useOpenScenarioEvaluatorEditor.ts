/**
 * Opens the evaluator editor drawer on one attachment of a suite or a run
 * plan.
 *
 * The drawer is the same one the evaluations workbench opens: the sources it
 * offers for the mappings are the conversation, the scenario and the trace,
 * and under the mappings it carries the gate switch and the way to take the
 * attachment off. Every edit writes straight back into the attachment through
 * flow callbacks, so the chip behind the drawer follows as the person maps.
 *
 * @see specs/features/agent-testing/suite-editor.feature
 * @see dev/docs/best_practices/drawers.md
 */

import { useCallback } from "react";
import type { FieldMapping as UIFieldMapping } from "~/components/variables";
import { createEvaluatorEditorCallbacks } from "~/experiments-v3/utils/evaluatorEditorCallbacks";
import { setFlowCallbacks, useDrawer } from "~/hooks/useDrawer";
import {
  type EvaluatorAttachment,
  type ScenarioMapping,
  type ScenarioMappingContext,
  scenarioMappingSchema,
  scenarioMappingSources,
} from "~/server/scenarios/evaluator-attachments";
import {
  type AttachableEvaluator,
  evaluatorCanRequire,
  evaluatorTypeOf,
} from "./attachment-rules";

export type OpenScenarioEvaluatorEditorParams = {
  attachment: EvaluatorAttachment;
  evaluator: AttachableEvaluator;
  ctx: ScenarioMappingContext;
  /** True for a run plan, which offers no scenario field to map to. */
  planLevel?: boolean;
  onMappingChange: (input: string, mapping: ScenarioMapping | undefined) => void;
  onRequiredChange: (required: boolean) => void;
  onRemove: () => void;
};

/**
 * A mapping as the picker reports it, checked against the grammar the run
 * reads. The picker only offers the sources it was handed, so a mapping that
 * fails here is a picker bug rather than a person's mistake, and it is
 * dropped rather than stored.
 */
function toScenarioMapping(
  mapping: UIFieldMapping | undefined,
): ScenarioMapping | undefined {
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
      planLevel,
      onMappingChange,
      onRequiredChange,
      onRemove,
    }: OpenScenarioEvaluatorEditorParams) => {
      const mappingsConfig = {
        availableSources: scenarioMappingSources(ctx, { planLevel }),
        initialMappings: attachment.mappings,
      };
      const handleMappingChange = (
        input: string,
        mapping: UIFieldMapping | undefined,
      ) => onMappingChange(input, toScenarioMapping(mapping));

      // A code evaluator has its own editor, which holds its inputs beside
      // the code; the generic editor could only show the mappings.
      if (evaluator.type === "code") {
        setFlowCallbacks("codeEvaluatorEditor", {
          ...createEvaluatorEditorCallbacks({
            onMappingChange: handleMappingChange,
          }),
        });
        openDrawer("codeEvaluatorEditor", {
          evaluatorId: evaluator.id,
          mappingsConfig,
        });
        return;
      }

      setFlowCallbacks("evaluatorEditor", {
        ...createEvaluatorEditorCallbacks({
          onMappingChange: handleMappingChange,
        }),
        onRequiredChange,
        onRemove,
      });
      openDrawer("evaluatorEditor", {
        evaluatorId: evaluator.id,
        evaluatorType: evaluatorTypeOf(evaluator),
        mappingsConfig,
        gate: {
          required: attachment.required,
          canRequire: evaluatorCanRequire(evaluator),
        },
      });
    },
    [openDrawer],
  );
}
