/**
 * Shown when a run would cost more than the auto-run threshold: the question,
 * the rows, the cost, and the two ways out.
 * @see specs/traces-v2/instant-eval-search.feature
 */

import { Button, HStack, Text, VStack } from "@chakra-ui/react";

import { Dialog } from "../dialog.tsx";

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
    <Dialog.Root
      open={confirmation !== null}
      onOpenChange={({ open }) => !open && onClose()}
      size="sm"
    >
      <Dialog.Content bg="bg">
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <Dialog.Title>Judge each result?</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
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
                  {formatUsd(confirmation.freeBudgetRemainingUsd)} of the free Instant Evals budget
                  is left.
                </Text>
              )}
            </VStack>
          )}
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="ghost" size="sm" onClick={onSearchWords}>
            Search the words instead
          </Button>
          <Button colorPalette="orange" size="sm" onClick={onRun} loading={isStarting}>
            Run
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
