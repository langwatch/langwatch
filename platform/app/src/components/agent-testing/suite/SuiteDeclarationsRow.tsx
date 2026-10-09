/**
 * The line under the suite name: the fields its scenarios carry, and the
 * evaluators every run in it gets. A group is shown only when it has
 * something to list, and a suite with neither shows no line at all.
 *
 * Every chip opens the suite editor; an evaluator pill opens it on that
 * attachment.
 *
 * @see specs/features/agent-testing/suite-editor.feature
 */

import { chakra, HStack, Icon, Text } from "@chakra-ui/react";
import { Hash, ToggleLeft, Type } from "lucide-react";
import type { EvaluatorAttachment } from "~/server/scenarios/evaluator-attachments";
import type {
  SuiteFieldDefinition,
  SuiteFieldType,
} from "~/server/scenarios/suite-fields";
import { missingInputsOf } from "../evaluators/attachment-rules";
import { EvaluatorPill } from "../evaluators/EvaluatorPill";
import { useProjectEvaluators } from "../evaluators/useProjectEvaluators";
import { FG_MUTED } from "../shared/design";

/** The icon each field type reads with. */
const FIELD_TYPE_ICONS: Record<SuiteFieldType, typeof Type> = {
  text: Type,
  number: Hash,
  boolean: ToggleLeft,
};

function FieldChip({
  field,
  onClick,
}: {
  field: SuiteFieldDefinition;
  onClick?: () => void;
}) {
  return (
    <chakra.button
      type="button"
      display="inline-flex"
      alignItems="center"
      gap={1}
      height="24px"
      paddingX="8px"
      borderRadius="full"
      borderWidth="1px"
      borderColor="border"
      background="bg.muted/60"
      fontFamily="mono"
      fontSize="11px"
      color="fg"
      cursor={onClick ? "pointer" : "default"}
      _hover={onClick ? { borderColor: "border.emphasized" } : undefined}
      title={field.type}
      onClick={onClick}
      data-testid={`suite-field-chip-${field.identifier}`}
    >
      <Icon as={FIELD_TYPE_ICONS[field.type]} boxSize="11px" color={FG_MUTED} />
      {field.identifier}
    </chakra.button>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text fontSize="11px" fontWeight="medium" color={FG_MUTED} flexShrink={0}>
      {children}
    </Text>
  );
}

export type SuiteDeclarationsRowProps = {
  fields: SuiteFieldDefinition[];
  evaluators: EvaluatorAttachment[];
  /** Opens the suite editor, on one attachment when a pill asked for it. */
  onEdit?: (attachmentId?: string) => void;
};

/**
 * The evaluator pills, which read the saved evaluators for their names. A
 * suite with no evaluator never mounts this, so it never reads them.
 */
function EvaluatorsGroup({
  evaluators,
  onEdit,
}: Pick<SuiteDeclarationsRowProps, "evaluators" | "onEdit">) {
  const { evaluatorsById } = useProjectEvaluators();

  return (
    <HStack gap={1.5} flexWrap="wrap" data-testid="suite-evaluators-group">
      <GroupLabel>Evaluators</GroupLabel>
      {evaluators.map((attachment) => {
        const evaluator = evaluatorsById.get(attachment.evaluatorId);
        return (
          <EvaluatorPill
            key={attachment.id}
            attachmentId={attachment.id}
            name={evaluator?.name ?? attachment.evaluatorId}
            required={attachment.required}
            missingInputs={missingInputsOf({ attachment, evaluator })}
            onClick={onEdit ? () => onEdit(attachment.id) : undefined}
          />
        );
      })}
    </HStack>
  );
}

export function SuiteDeclarationsRow({
  fields,
  evaluators,
  onEdit,
}: SuiteDeclarationsRowProps) {
  if (fields.length === 0 && evaluators.length === 0) return null;

  return (
    <HStack
      gap={4}
      rowGap={1.5}
      flexWrap="wrap"
      alignItems="center"
      data-testid="suite-declarations-row"
    >
      {fields.length > 0 && (
        <HStack gap={1.5} flexWrap="wrap" data-testid="suite-fields-group">
          <GroupLabel>Fields</GroupLabel>
          {fields.map((field) => (
            <FieldChip
              key={field.identifier}
              field={field}
              onClick={onEdit ? () => onEdit() : undefined}
            />
          ))}
        </HStack>
      )}
      {evaluators.length > 0 && (
        <EvaluatorsGroup evaluators={evaluators} onEdit={onEdit} />
      )}
    </HStack>
  );
}

/** "4 scenarios · 2 fields · 1 evaluator", with only the groups that count. */
export function declarationsCountLine({
  caseCount,
  fieldCount,
  evaluatorCount,
}: {
  caseCount: number;
  fieldCount: number;
  evaluatorCount: number;
}): string {
  const parts = [`${caseCount} ${caseCount === 1 ? "scenario" : "scenarios"}`];
  if (fieldCount > 0) {
    parts.push(`${fieldCount} ${fieldCount === 1 ? "field" : "fields"}`);
  }
  if (evaluatorCount > 0) {
    parts.push(
      `${evaluatorCount} ${evaluatorCount === 1 ? "evaluator" : "evaluators"}`,
    );
  }
  return parts.join(" · ");
}
