import { describeError, showErrorToast } from "@langwatch/browser-host/errors";
import { Dialog } from "@langwatch/design-system/dialog";
import { Alert, HStack, Separator, Text, VStack } from "@langwatch/design-system/primitives";
import { SkeletonRows } from "@langwatch/design-system/skeletons";
import type { SeatProrationPreviewProps } from "@langwatch/enterprise-billing-client";
import { Crown } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { billingApi } from "../../../behavior/billing-api.ts";

// The contract answers this one with the provider's own shape, deliberately
// opaque, so the screen states what it reads and checks the answer against it.
const prorationQuoteSchema = z.object({
  amountDueCents: z.number(),
  formattedAmountDue: z.string(),
  formattedCreditApplied: z.string().nullable(),
  formattedRecurringTotal: z.string(),
  billingInterval: z.string(),
  quotedAt: z.number(),
});

type ProrationQuote = z.infer<typeof prorationQuoteSchema>;

function quoteOf(data: unknown): ProrationQuote | undefined {
  const parsed = prorationQuoteSchema.safeParse(data);

  return parsed.success ? parsed.data : void 0;
}

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
          <Text fontSize="sm" color="fg.muted">
            Current seats
          </Text>
          <Text fontSize="2xl" fontWeight="bold">
            {currentSeats}
          </Text>
        </VStack>
        <Text fontSize="xl" color="fg.subtle" alignSelf="center">
          →
        </Text>
        <VStack align="end" gap={1}>
          <Text fontSize="sm" color="fg.muted">
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
              <Text fontWeight="normal" fontSize="sm" color="fg.muted">
                Account credit applied
              </Text>
              <Text fontWeight="normal" fontSize="sm" color="fg.muted">
                −{quote.formattedCreditApplied}
              </Text>
            </HStack>
          )}

          <HStack justify="space-between" paddingX={2}>
            <Text fontWeight="normal" fontSize="md" color="fg.muted">
              New billing amount
            </Text>
            <Text fontWeight="normal" fontSize="md" color="fg.muted">
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
 * What a seat change costs, and the dialog that confirms it. Lent to the
 * upgrade gate by `SeatProrationPreviewToken` — licensing decides when it
 * opens, billing draws the price and the dialog. specs/licensing/proration-preview.feature.
 */
export function SeatProrationPreview({ variant, open, onClose }: SeatProrationPreviewProps) {
  const [isConfirming, setIsConfirming] = useState(false);

  const preview = billingApi.subscription.previewProration.useQuery(
    { organizationId: variant.organizationId, newTotalSeats: variant.newSeats },
    { enabled: open },
  );

  const confirm = async () => {
    setIsConfirming(true);
    try {
      await variant.onConfirm(quoteOf(preview.data)?.quotedAt);
      onClose();
    } catch (error) {
      showErrorToast({ error, fallbackTitle: "Couldn't update your seats" });
    } finally {
      setIsConfirming(false);
    }
  };

  const isPreviewLoading = preview.isLoading;
  const isPreviewError = !isPreviewLoading && preview.isError;
  const isPreviewReady = !isPreviewLoading && !preview.isError;

  const primaryDisabledReason = isPreviewLoading
    ? "Loading the cost preview"
    : disabledReasonOfError(isPreviewError);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      icon={<Crown />}
      title="Confirm seat update"
      busy={isConfirming}
      primaryAction={{
        label: "Confirm & Update",
        onClick: () => void confirm(),
        loading: isConfirming,
        disabledReason: primaryDisabledReason,
      }}
    >
      {isPreviewLoading && <SkeletonRows rows={3} label="Loading the cost preview" />}
      {isPreviewError && (
        <Alert.Root status="error" role="alert">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>
              {describeError({
                error: preview.error,
                fallbackTitle: "Couldn't load the price preview",
              })}
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}
      {isPreviewReady && (
        <PreviewBody
          quote={quoteOf(preview.data)}
          currentSeats={variant.currentSeats}
          newSeats={variant.newSeats}
        />
      )}
    </Dialog>
  );
}

function disabledReasonOfError(failed: boolean): string | undefined {
  return failed ? "The price preview did not load" : void 0;
}

/**
 * The billing period, spelled out next to an amount the customer is about
 * to confirm. Every provider period gets its own words; an unrecognised
 * one says nothing rather than showing a wrong period as "per month".
 */
function formatBillingPeriod(interval: string): string {
  switch (interval) {
    case "year":
      return " per year";
    case "month":
      return " per month";
    case "week":
      return " per week";
    case "day":
      return " per day";
    default:
      return "";
  }
}
