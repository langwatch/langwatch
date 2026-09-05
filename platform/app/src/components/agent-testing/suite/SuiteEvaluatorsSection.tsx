/**
 * The evaluators section of the suite editor: the attachments as pills, and
 * the button that adds one more. A pill opens its editor.
 *
 * @see specs/features/agent-testing/suite-editor.feature
 */

import { Text, VStack } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import type {
  EvaluatorAttachment,
  EvaluatorInputSpec,
} from "~/server/scenarios/evaluator-attachments";
import type { AttachableEvaluator } from "../evaluators/attachment-rules";
import { EvaluatorPill, EvaluatorPillRow } from "../evaluators/EvaluatorPill";
import { FieldError, FieldLabel } from "../shared/DialogFields";
import { FG_MUTED } from "../shared/design";
import { RemoveBlockButton } from "../shared/RemoveBlockButton";
import { SmallButton } from "../shared/SmallButton";

export const EVALUATORS_SECTION_HELP =
  "Every conversation in this suite gets these checks, on top of its criteria.";

export type SuiteEvaluatorsSectionProps = {
  attachments: EvaluatorAttachment[];
  evaluatorsById: ReadonlyMap<string, AttachableEvaluator>;
  missingOf: (attachment: EvaluatorAttachment) => EvaluatorInputSpec[];
  /** A refusal about the evaluators as a whole. */
  error?: string;
  onEdit: (attachment: EvaluatorAttachment) => void;
  onAdd: () => void;
  onClose: () => void;
};

/**
 * The pills and the add button, which the suite editor and the run dialog
 * both draw. The attachment id keys each pill, so two attachments of one
 * evaluator read apart.
 */
export function AttachmentPills({
  attachments,
  evaluatorsById,
  missingOf,
  onEdit,
  onAdd,
  addTestId = "suite-add-evaluator",
}: Pick<
  SuiteEvaluatorsSectionProps,
  "attachments" | "evaluatorsById" | "missingOf" | "onEdit" | "onAdd"
> & { addTestId?: string }) {
  return (
    <EvaluatorPillRow>
      {attachments.map((attachment) => (
        <EvaluatorPill
          key={attachment.id}
          attachmentId={attachment.id}
          name={
            evaluatorsById.get(attachment.evaluatorId)?.name ??
            attachment.evaluatorId
          }
          required={attachment.required}
          missingInputs={missingOf(attachment)}
          onClick={() => onEdit(attachment)}
        />
      ))}
      <SmallButton
        height="24px"
        minHeight="24px"
        fontSize="11px"
        onClick={onAdd}
        data-testid={addTestId}
      >
        <Plus size={12} />
        Add evaluator
      </SmallButton>
    </EvaluatorPillRow>
  );
}

export function SuiteEvaluatorsSection({
  attachments,
  evaluatorsById,
  missingOf,
  error,
  onEdit,
  onAdd,
  onClose,
}: SuiteEvaluatorsSectionProps) {
  return (
    <VStack align="stretch" gap={1.5} data-testid="suite-evaluators-section">
      <FieldLabel>
        Evaluators
        <RemoveBlockButton label="Remove the evaluators" onClick={onClose} />
      </FieldLabel>
      <Text fontSize="11px" color={FG_MUTED}>
        {EVALUATORS_SECTION_HELP}
      </Text>
      <AttachmentPills
        attachments={attachments}
        evaluatorsById={evaluatorsById}
        missingOf={missingOf}
        onEdit={onEdit}
        onAdd={onAdd}
      />
      <FieldError message={error} />
    </VStack>
  );
}
