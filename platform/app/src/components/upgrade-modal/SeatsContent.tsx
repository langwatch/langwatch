import { Button, HStack, Separator, Spinner, Text, VStack } from "@chakra-ui/react";
import { Crown } from "lucide-react";
import { useState } from "react";
import { HandledErrorAlert, showErrorToast } from "~/features/errors";
import type { UpgradeModalVariant } from "../../stores/upgradeModalStore";
import { api } from "../../utils/api";
import { Dialog } from "../ui/dialog";

type ProrationQueryResult =
  | {
      data?: {
        amountDueCents: number;
        formattedAmountDue: string;
        formattedCreditApplied: string | null;
        formattedRecurringTotal: string;
        billingInterval: string;
        quotedAt: number;
      };
      isLoading: boolean;
      isError: boolean;
      /** The query's error, passed straight to the alert — handled or not.
       *  Never read `.message`: since #5984 that is the error's code slug. */
      error?: unknown;
    }
  | undefined;

/**
 * The billing period, spelled out next to an amount the customer is about to
 * confirm.
 *
 * Every period the payment provider can report gets its own words. Collapsing
 * the unknown ones to "per month" would put a wrong period beside a real
 * charge, so an unrecognised one says nothing rather than something false.
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

function SeatsProrationPreview({
  hasSubscriptionApi,
  prorationQuery,
  currentSeats,
  newSeats,
}: {
  hasSubscriptionApi: boolean;
  prorationQuery: ProrationQueryResult;
  currentSeats: number;
  newSeats: number;
}) {
  const isLoading = prorationQuery?.isLoading ?? false;
  const isError = prorationQuery?.isError ?? false;
  const data = prorationQuery?.data;

  if (!hasSubscriptionApi) {
    return <Text>Seat management is not available in this deployment.</Text>;
  }

  if (isLoading) {
    return (
      <HStack justify="center" width="100%" paddingY={6}>
        <Spinner />
      </HStack>
    );
  }

  if (isError) {
    return (
      <HandledErrorAlert
        error={prorationQuery?.error}
        fallbackTitle="Couldn't load the price preview"
      />
    );
  }

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

      {data && (
        <VStack gap={3} align="stretch">
          {/* Confirming charges this immediately, so it is the headline number
              rather than a footnote — the recurring total below is what the
              plan costs from the next invoice onwards. */}
          <HStack justify="space-between" paddingX={2}>
            <Text fontWeight="semibold" fontSize="md">
              {data.amountDueCents < 0 ? "Credit applied today" : "Due today"}
            </Text>
            <Text fontWeight="semibold" fontSize="md">
              {data.formattedAmountDue}
            </Text>
          </HStack>

          {/* Why "Due today" is smaller than the change itself. Without this
              line an account holding credit reads a charge it cannot account
              for, and the natural conclusion is that the number is wrong. */}
          {data.formattedCreditApplied && (
            <HStack justify="space-between" paddingX={2}>
              <Text fontWeight="normal" fontSize="sm" color="gray.500">
                Account credit applied
              </Text>
              <Text fontWeight="normal" fontSize="sm" color="gray.500">
                −{data.formattedCreditApplied}
              </Text>
            </HStack>
          )}

          <HStack justify="space-between" paddingX={2}>
            <Text fontWeight="normal" fontSize="md" color="gray.500">
              New billing amount
            </Text>
            <Text fontWeight="normal" fontSize="md" color="gray.500">
              {data.formattedRecurringTotal}
              {formatBillingPeriod(data.billingInterval)}
            </Text>
          </HStack>
        </VStack>
      )}
    </VStack>
  );
}

export function SeatsContent({
  variant,
  onClose,
  open,
}: {
  variant: Extract<UpgradeModalVariant, { mode: "seats" }>;
  onClose: () => void;
  open: boolean;
}) {
  const [isConfirming, setIsConfirming] = useState(false);

  // SaaS-only: subscription API may not exist in OSS builds.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subscriptionApi = (api as any).subscription;
  // Build-time invariant: subscriptionApi shape is fixed per build (SaaS vs OSS)
  const hasSubscriptionApi = !!subscriptionApi;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const prorationQuery = subscriptionApi?.previewProration?.useQuery(
    {
      organizationId: variant.organizationId,
      newTotalSeats: variant.newSeats,
    },
    { enabled: open && hasSubscriptionApi },
  ) as ProrationQueryResult;

  const handleConfirm = async () => {
    setIsConfirming(true);
    try {
      await variant.onConfirm(prorationQuery?.data?.quotedAt);
      onClose();
    } catch (err) {
      showErrorToast({
        error: err,
        fallbackTitle: "Couldn't update your seats",
      });
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
        <SeatsProrationPreview
          hasSubscriptionApi={hasSubscriptionApi}
          prorationQuery={prorationQuery}
          currentSeats={variant.currentSeats}
          newSeats={variant.newSeats}
        />
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="ghost" onClick={onClose} disabled={isConfirming}>
          Cancel
        </Button>
        <Button
          colorPalette="blue"
          onClick={() => void handleConfirm()}
          loading={isConfirming}
          disabled={
            prorationQuery?.isLoading || prorationQuery?.isError || !subscriptionApi
          }
        >
          Confirm & Update
        </Button>
      </Dialog.Footer>
    </>
  );
}
