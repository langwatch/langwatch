/**
 * One attached evaluator as a pill: its name, a dot when it is required, and
 * the amber border with the pulsing alert when a required input reads
 * nothing yet. The suite editor, the header line and the run dialog all draw
 * an attachment this way.
 *
 * @see specs/features/agent-testing/suite-editor.feature
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { Circle, chakra, HStack, Icon, Text } from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import { CircleAlert } from "lucide-react";
import { REQUIRED_TO_PASS_LABEL } from "~/components/evaluators/EvaluatorEditorShared";
import { Tooltip } from "~/components/ui/tooltip";
import { SCENARIO_MISSING_MAPPING_TOOLTIP } from "~/server/scenarios/evaluator-attachments";
import { FG_MUTED } from "../shared/design";

const pulse = keyframes`
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.2); }
`;

/** The border, background, text color and hover styling of one pill. */
function pillStyle({
  isMissing,
  inherited,
  onClick,
  selected,
}: {
  isMissing: boolean;
  inherited: boolean;
  onClick?: () => void;
  selected: boolean;
}) {
  return {
    borderColor: isMissing ? "orange.solid" : "border",
    background: isMissing ? "orange.subtle" : "bg.muted/60",
    color: isMissing ? "orange.fg" : inherited ? FG_MUTED : "fg",
    cursor: onClick ? "pointer" : "default",
    outline: selected ? "1px solid" : undefined,
    outlineColor: selected ? "blue.solid" : undefined,
    hoverStyle: onClick ? { borderColor: "border.emphasized" } : undefined,
  };
}

export type EvaluatorPillProps = {
  /** The attachment id, which is what a test addresses the pill by. */
  attachmentId: string;
  name: string;
  required: boolean;
  /** The required inputs that read nothing yet. */
  missingInputs: readonly { id: string }[];
  /** True for an evaluator a suite in scope carries, which is edited there. */
  inherited?: boolean;
  /** True while the editor is open on this attachment. */
  selected?: boolean;
  /** What the pointer reads over the pill, when nothing is missing. */
  title?: string;
  onClick?: () => void;
};

export function EvaluatorPill({
  attachmentId,
  name,
  required,
  missingInputs,
  inherited = false,
  selected = false,
  title,
  onClick,
}: EvaluatorPillProps) {
  const isMissing = missingInputs.length > 0;
  const style = pillStyle({ isMissing, inherited, onClick, selected });
  const pill = (
    <chakra.button
      type="button"
      display="inline-flex"
      alignItems="center"
      gap={1.5}
      height="24px"
      paddingX="10px"
      borderRadius="full"
      borderWidth="1px"
      borderColor={style.borderColor}
      background={style.background}
      color={style.color}
      fontSize="11px"
      fontWeight="medium"
      cursor={style.cursor}
      outline={style.outline}
      outlineColor={style.outlineColor}
      _hover={style.hoverStyle}
      onClick={onClick}
      title={isMissing ? undefined : title}
      aria-label={name}
      data-testid={`evaluator-pill-${attachmentId}`}
      data-missing={isMissing ? "true" : undefined}
      data-inherited={inherited ? "true" : undefined}
    >
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
          css={{ animation: `${pulse} 2s ease-in-out infinite` }}
          data-testid={`evaluator-pill-alert-${attachmentId}`}
        />
      )}
    </chakra.button>
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

/** The pills of a list, in one wrapping line. */
export function EvaluatorPillRow({ children }: { children: React.ReactNode }) {
  return (
    <HStack gap={1.5} flexWrap="wrap" alignItems="center">
      {children}
    </HStack>
  );
}
