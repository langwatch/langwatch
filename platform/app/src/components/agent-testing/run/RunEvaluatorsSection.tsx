/**
 * The Evaluators block of the run dialog: the evaluators the suites in scope
 * carry, muted and edited in the suite, and under them the plan's own, as
 * pills with an Add evaluator button.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { Text, VStack } from "@chakra-ui/react";
import type {
  EvaluatorAttachment,
  EvaluatorInputSpec,
} from "~/server/scenarios/evaluator-attachments";
import type { AttachableEvaluator } from "../evaluators/attachment-rules";
import { EvaluatorPill, EvaluatorPillRow } from "../evaluators/EvaluatorPill";
import { FieldLabel } from "../shared/DialogFields";
import { FG_MUTED } from "../shared/design";
import { RemoveBlockButton } from "../shared/RemoveBlockButton";
import { AttachmentPills } from "../suite/SuiteEvaluatorsSection";
import type { InheritedSuite } from "./run-evaluators";

/** What the line over a suite's evaluators reads. */
export function inheritedLabel(suiteName: string): string {
  return `Inherited from ${suiteName} · edit in the suite`;
}

export type RunEvaluatorsSectionProps = {
  inherited: InheritedSuite[];
  extras: EvaluatorAttachment[];
  evaluatorsById: ReadonlyMap<string, AttachableEvaluator>;
  missingOf: (attachment: EvaluatorAttachment) => EvaluatorInputSpec[];
  onOpenInherited: (input: { suiteId: string; attachmentId: string }) => void;
  onEditExtra: (attachment: EvaluatorAttachment) => void;
  onAddExtra: () => void;
  /** Takes the block away. Absent while a suite in scope holds it open. */
  onRemove?: () => void;
};

/** The pills of one inherited suite's evaluators, under its own label. */
function InheritedSuiteEvaluators({
  suite,
  evaluatorsById,
  missingOf,
  onOpenInherited,
}: {
  suite: InheritedSuite;
  evaluatorsById: ReadonlyMap<string, AttachableEvaluator>;
  missingOf: (attachment: EvaluatorAttachment) => EvaluatorInputSpec[];
  onOpenInherited: (input: { suiteId: string; attachmentId: string }) => void;
}) {
  return (
    <VStack
      align="stretch"
      gap={1}
      data-testid={`run-dialog-inherited-${suite.suiteId}`}
    >
      <Text fontSize="11px" color={FG_MUTED}>
        {inheritedLabel(suite.suiteName)}
      </Text>
      <EvaluatorPillRow>
        {suite.attachments.map((attachment) => (
          <EvaluatorPill
            key={attachment.id}
            attachmentId={attachment.id}
            name={
              evaluatorsById.get(attachment.evaluatorId)?.name ??
              attachment.evaluatorId
            }
            required={attachment.required}
            missingInputs={missingOf(attachment)}
            inherited
            onClick={() =>
              onOpenInherited({
                suiteId: suite.suiteId,
                attachmentId: attachment.id,
              })
            }
          />
        ))}
      </EvaluatorPillRow>
    </VStack>
  );
}

export function RunEvaluatorsSection({
  inherited,
  extras,
  evaluatorsById,
  missingOf,
  onOpenInherited,
  onEditExtra,
  onAddExtra,
  onRemove,
}: RunEvaluatorsSectionProps) {
  return (
    <VStack align="stretch" gap={0} data-testid="run-dialog-evaluators">
      <FieldLabel>
        Evaluators
        {onRemove && (
          <RemoveBlockButton label="Remove the evaluators" onClick={onRemove} />
        )}
      </FieldLabel>
      <VStack
        align="stretch"
        gap={2.5}
        borderWidth="1px"
        borderColor="border"
        borderRadius="lg"
        paddingX={3}
        paddingY={2.5}
      >
        {inherited.map((suite) => (
          <InheritedSuiteEvaluators
            key={suite.suiteId}
            suite={suite}
            evaluatorsById={evaluatorsById}
            missingOf={missingOf}
            onOpenInherited={onOpenInherited}
          />
        ))}
        <VStack align="stretch" gap={1}>
          {inherited.length > 0 && (
            <Text fontSize="11px" color={FG_MUTED}>
              On this run
            </Text>
          )}
          <AttachmentPills
            attachments={extras}
            evaluatorsById={evaluatorsById}
            missingOf={missingOf}
            onEdit={onEditExtra}
            onAdd={onAddExtra}
            addTestId="run-dialog-add-evaluator"
          />
        </VStack>
      </VStack>
    </VStack>
  );
}
