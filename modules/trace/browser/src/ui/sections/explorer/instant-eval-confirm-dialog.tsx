/**
 * Shown when a run would cost more than the auto-run threshold: the question,
 * the rows, the cost, and the two ways out.
 * @see specs/traces-v2/instant-eval-search.feature
 */

import { Dialog } from "@langwatch/design-system/dialog";
import { HStack, Text, VStack } from "@langwatch/design-system/primitives";

export interface InstantEvalConfirmation {
  /** The question as the judge will read it. */
  question: string;
  /** What counts as yes, then what counts as no, when the router wrote them. */
  criteria?: readonly [string, string];
  rows: number;
  /** Whether the run will stop at the row cap before the selection ends. */
  isRowsCapped: boolean;
  priceUsd: number;
  /** What is left of the free budget, for an organization without a paid plan. */
  freeBudgetRemainingUsd?: number;
}

interface InstantEvalConfirmDialogProps {
  confirmation: InstantEvalConfirmation | null;
  isStarting: boolean;
  onRun: () => void;
  /** Search the words as a phrase instead of judging anything. */
  onSearchWords: () => void;
  onClose: () => void;
}

/** The estimated cost, in United States dollars, to the cent. */
export function formatUsd(amount: number): string {
  return `${amount.toFixed(2)} USD`;
}

export function InstantEvalConfirmDialog({
  confirmation,
  isStarting,
  onRun,
  onSearchWords,
  onClose,
}: InstantEvalConfirmDialogProps) {
  return (
    <Dialog
      open={confirmation !== null}
      onClose={onClose}
      title="Judge each result?"
      size="sm"
      cancelLabel={null}
      secondaryAction={{ label: "Search the words instead", onClick: onSearchWords }}
      primaryAction={{ label: "Run", onClick: onRun, loading: isStarting }}
    >
      {confirmation && (
        <VStack align="stretch" gap={3}>
          <VStack align="stretch" gap={1}>
            <Text textStyle="xs" color="fg.muted">
              The question, as the judge reads it
            </Text>
            <Text textStyle="sm" fontWeight="medium">
              {confirmation.question}
            </Text>
            {confirmation.criteria && (
              // Shown as the classifier wrote them: whole sentences as
              // often as fragments, so never folded into one of our own.
              <VStack align="stretch" gap={0.5}>
                <Text textStyle="xs" color="fg.muted">
                  <Text as="span" fontWeight="medium">
                    Yes:
                  </Text>{" "}
                  {confirmation.criteria[0]}
                </Text>
                <Text textStyle="xs" color="fg.muted">
                  <Text as="span" fontWeight="medium">
                    No:
                  </Text>{" "}
                  {confirmation.criteria[1]}
                </Text>
              </VStack>
            )}
          </VStack>
          <HStack gap={6}>
            <VStack align="start" gap={0}>
              <Text textStyle="xs" color="fg.muted">
                Rows to judge
              </Text>
              <Text
                textStyle="sm"
                fontVariantNumeric="tabular-nums"
                data-testid="instant-eval-rows"
              >
                {confirmation.rows.toLocaleString()}
                {confirmation.isRowsCapped ? " (the run's limit)" : ""}
              </Text>
            </VStack>
            <VStack align="start" gap={0}>
              <Text textStyle="xs" color="fg.muted">
                Estimated cost
              </Text>
              <Text
                textStyle="sm"
                fontVariantNumeric="tabular-nums"
                data-testid="instant-eval-price"
              >
                {formatUsd(confirmation.priceUsd)}
              </Text>
            </VStack>
          </HStack>
          {confirmation.freeBudgetRemainingUsd !== undefined && (
            <Text textStyle="xs" color="fg.muted">
              {formatUsd(confirmation.freeBudgetRemainingUsd)} of the free Instant Evals budget is
              left.
            </Text>
          )}
        </VStack>
      )}
    </Dialog>
  );
}
