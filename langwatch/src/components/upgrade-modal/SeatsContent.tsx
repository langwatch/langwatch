import {
  Button,
  HStack,
  Separator,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Crown } from "lucide-react";
import { useState } from "react";
import type { UpgradeModalVariant } from "../../stores/upgradeModalStore";
import { api } from "../../utils/api";
import { Dialog } from "../ui/dialog";
import { toaster } from "../ui/toaster";

type ProrationQueryResult =
  | {
      data?: {
        formattedRecurringTotal: string;
        billingInterval: string;
      };
      isLoading: boolean;
      isError: boolean;
      error?: { message: string };
    }
  | undefined;

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
  const errorMessage =
    prorationQuery?.error?.message ?? "Failed to load proration preview";
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
    return <Text color="red.500">{errorMessage}</Text>;
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
        <HStack justify="space-between" paddingX={2}>
          <Text fontWeight="normal" fontSize="md" color="gray.500">
            New billing amount
          </Text>
          <Text fontWeight="normal" fontSize="md" color="gray.500">
            {data.formattedRecurringTotal}
          </Text>
        </HStack>
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
      await variant.onConfirm();
      onClose();
    } catch (err) {
      toaster.create({
        title: "Error updating seats",
        description:
          err instanceof Error ? err.message : "An unexpected error occurred",
        type: "error",
        meta: { closable: true },
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
            prorationQuery?.isLoading ||
            prorationQuery?.isError ||
            !subscriptionApi
          }
        >
          Confirm & Update
        </Button>
      </Dialog.Footer>
    </>
  );
}
