import { Box, Button, HStack, Separator, Spinner, Text, VStack } from "@chakra-ui/react";
import { Dialog } from "@langwatch/design-system/dialog";
import { describeError, showErrorToast } from "@langwatch/ui-host/errors";
import type { UiSlotProps } from "@langwatch/ui-host/slots";
import { Crown } from "lucide-react";
import { useState } from "react";
import { billingApi } from "../../behavior/billing-api";
import { formatBillingPeriod } from "./billing-period";

type ProrationQuote = {
  amountDueCents: number;
  formattedAmountDue: string;
  formattedCreditApplied: string | null;
  formattedRecurringTotal: string;
  billingInterval: string;
  quotedAt: number;
};

function PreviewBody({
  quote,
  currentSeats,
  newSeats,
}: {
  quote: ProrationQuote | undefined;
  currentSeats: number;
  newSeats: number;
}) {
  return (
    <VStack gap={6} align="stretch" paddingY={2}>
      <HStack justify="space-between" paddingX={2}>
        <VStack align="start" gap={1}>
          <Text fontSize="sm" color="gray.500">
            Current seats
          </Text>
          <Text fontSize="2xl" fontWeight="bold">
            {currentSeats}
          </Text>
        </VStack>
        <Text fontSize="xl" color="gray.400" alignSelf="center">
          →
        </Text>
        <VStack align="end" gap={1}>
          <Text fontSize="sm" color="gray.500">
            New total seats
          </Text>
          <Text fontSize="2xl" fontWeight="bold">
            {newSeats}
          </Text>
        </VStack>
      </HStack>

      <Separator />

      {quote && (
        <VStack gap={3} align="stretch">
          {/* Confirming charges this immediately, so it is the headline number
              rather than a footnote — the recurring total below is what the
              plan costs from the next invoice onwards. */}
          <HStack justify="space-between" paddingX={2}>
            <Text fontWeight="semibold" fontSize="md">
              {quote.amountDueCents < 0 ? "Credit applied today" : "Due today"}
            </Text>
            <Text fontWeight="semibold" fontSize="md">
              {quote.formattedAmountDue}
            </Text>
          </HStack>

          {/* Why "Due today" is smaller than the change itself. Without this
              line an account holding credit reads a charge it cannot account
              for, and the natural conclusion is that the number is wrong. */}
          {quote.formattedCreditApplied && (
            <HStack justify="space-between" paddingX={2}>
              <Text fontWeight="normal" fontSize="sm" color="gray.500">
                Account credit applied
              </Text>
              <Text fontWeight="normal" fontSize="sm" color="gray.500">
                −{quote.formattedCreditApplied}
              </Text>
            </HStack>
          )}

          <HStack justify="space-between" paddingX={2}>
            <Text fontWeight="normal" fontSize="md" color="gray.500">
              New billing amount
            </Text>
            <Text fontWeight="normal" fontSize="md" color="gray.500">
              {quote.formattedRecurringTotal}
              {formatBillingPeriod(quote.billingInterval)}
            </Text>
          </HStack>
        </VStack>
      )}
    </VStack>
  );
}

/**
 * What a seat change costs, and the button that confirms it.
 *
 * Fills the upgrade dialog's `seatProrationPreview` slot: the dialog belongs to
 * licensing, the price belongs to billing, and this is where the two meet.
 * specs/licensing/proration-preview.feature.
 */
export function SeatProrationPreview({
  variant,
  open,
  onClose,
}: UiSlotProps["seatProrationPreview"]) {
  const [isConfirming, setIsConfirming] = useState(false);

  const preview = billingApi.subscription.previewProration.useQuery(
    { organizationId: variant.organizationId, newTotalSeats: variant.newSeats },
    { enabled: open },
  );

  const confirm = async () => {
    setIsConfirming(true);
    try {
      await variant.onConfirm(preview.data?.quotedAt);
      onClose();
    } catch (error) {
      showErrorToast({ error, fallbackTitle: "Couldn't update your seats" });
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <>
      <Dialog.Header>
        <Crown />
        <Dialog.Title>Confirm seat update</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body>
        {preview.isLoading ? (
          <HStack justify="center" width="100%" paddingY={6}>
            <Spinner />
          </HStack>
        ) : preview.isError ? (
          <Box role="alert" borderWidth="1px" borderColor="red.solid" borderRadius="md" padding={3}>
            <Text>
              {describeError({
                error: preview.error,
                fallbackTitle: "Couldn't load the price preview",
              })}
            </Text>
          </Box>
        ) : (
          <PreviewBody
            quote={preview.data}
            currentSeats={variant.currentSeats}
            newSeats={variant.newSeats}
          />
        )}
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="ghost" onClick={onClose} disabled={isConfirming}>
          Cancel
        </Button>
        <Button
          colorPalette="blue"
          onClick={() => void confirm()}
          loading={isConfirming}
          disabled={preview.isLoading || preview.isError}
        >
          Confirm & Update
        </Button>
      </Dialog.Footer>
    </>
  );
}
