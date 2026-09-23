/**
 * The evaluators section of the suite editor: the attachments as pills, and
 * the button that adds one more. A pill opens its editor.
 *
 * @see specs/features/agent-testing/suite-editor.feature
 */

import { Circle, chakra, Icon, Text, VStack } from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { REQUIRED_TO_PASS_LABEL } from "@langwatch/evaluator-browser/surfaces/evaluator-editor-shared";
import {
  SCENARIO_MISSING_MAPPING_TOOLTIP,
  type EvaluatorAttachment,
  type EvaluatorInputSpec,
} from "@langwatch/scenario-contract";
import { CircleAlert, Plus } from "lucide-react";

import type { AttachableEvaluator } from "../../../../model/agent-testing/evaluators/attachment-rules.ts";
import { FG_MUTED } from "../../../../model/agent-testing/shared/design.ts";
import { FieldError, FieldLabel } from "../shared/dialog-fields.tsx";
import { EvaluatorPillRow } from "../shared/evaluator-pill.tsx";
import { RemoveBlockButton } from "../shared/remove-block-button.tsx";
import { SmallButton } from "../shared/small-button.tsx";

export const EVALUATORS_SECTION_HELP =
  "Every conversation in this suite gets these checks, on top of its criteria.";

const requiredDotPulse = keyframes`
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.2); }
`;

function attachmentPillStyle({
  isMissing,
  inherited,
  onClick,
}: {
  isMissing: boolean;
  inherited: boolean;
  onClick?: () => void;
}) {
  const presentColor = inherited ? FG_MUTED : "fg";
  return {
    borderColor: isMissing ? "orange.solid" : "border",
    background: isMissing ? "orange.subtle" : "bg.muted/60",
    color: isMissing ? "orange.fg" : presentColor,
    cursor: onClick ? "pointer" : "default",
    hoverStyle: onClick ? { borderColor: "border.emphasized" } : undefined,
  };
}

export type EvaluatorAttachmentPillProps = {
  attachmentId: string;
  name: string;
  required: boolean;
  /** The required inputs that read nothing yet. */
  missingInputs: readonly EvaluatorInputSpec[];
  /** True for an evaluator a suite in scope carries, which is edited there. */
  inherited?: boolean;
  onClick?: () => void;
};

/**
 * One attached evaluator as a pill: its name, a dot when it is required, and
 * an amber alert when a required input reads nothing yet.
 */
export function EvaluatorAttachmentPill({
  attachmentId,
  name,
  required,
  missingInputs,
  inherited = false,
  onClick,
}: EvaluatorAttachmentPillProps) {
  const isMissing = missingInputs.length > 0;
  const style = attachmentPillStyle({ isMissing, inherited, onClick });
  const pillProps = {
    display: "inline-flex" as const,
    alignItems: "center" as const,
    gap: 1.5,
    height: "24px",
    paddingX: "10px",
    borderRadius: "full",
    borderWidth: "1px",
    borderColor: style.borderColor,
    background: style.background,
    color: style.color,
    fontSize: "11px",
    fontWeight: "medium" as const,
    cursor: style.cursor,
    _hover: style.hoverStyle,
    "aria-label": name,
    "data-testid": `evaluator-pill-${attachmentId}`,
    "data-missing": isMissing ? "true" : undefined,
    "data-inherited": inherited ? "true" : undefined,
  };
  const pillChildren = (
    <>
      {required && (
        <Circle
          size="6px"
          bg={isMissing ? "orange.solid" : "fg.subtle"}
          flexShrink={0}
          title={REQUIRED_TO_PASS_LABEL}
          data-testid={`evaluator-pill-required-${attachmentId}`}
        />
      )}
      <Text truncate maxWidth="180px">
        {name}
      </Text>
      {isMissing && (
        <Icon
          as={CircleAlert}
          boxSize="12px"
          flexShrink={0}
          css={{ animation: `${requiredDotPulse} 2s ease-in-out infinite` }}
          data-testid={`evaluator-pill-alert-${attachmentId}`}
        />
      )}
    </>
  );
  // A pill with nothing to click on is static content, not a control, so it
  // never renders as a button: a screen reader would announce a control that
  // does nothing when activated.
  const pill = onClick ? (
    <chakra.button type="button" onClick={onClick} {...pillProps}>
      {pillChildren}
    </chakra.button>
  ) : (
    <chakra.div {...pillProps}>{pillChildren}</chakra.div>
  );

  if (!isMissing) return pill;
  return (
    <Tooltip
      content={SCENARIO_MISSING_MAPPING_TOOLTIP}
      positioning={{ placement: "top" }}
      openDelay={0}
      showArrow
    >
      {pill}
    </Tooltip>
  );
}

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
        <EvaluatorAttachmentPill
          key={attachment.id}
          attachmentId={attachment.id}
          name={evaluatorsById.get(attachment.evaluatorId)?.name ?? attachment.evaluatorId}
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
