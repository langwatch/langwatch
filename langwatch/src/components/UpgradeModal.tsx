import { useRouter } from "next/router";
import { useState } from "react";
import {
  Button,
  HStack,
  Separator,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Crown } from "lucide-react";
import { Dialog } from "./ui/dialog";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { usePlanManagementUrl } from "../hooks/usePlanManagementUrl";
import { trackEvent } from "../utils/tracking";
import { LIMIT_TYPE_LABELS } from "../server/license-enforcement/constants";
import { api } from "../utils/api";
import { toaster } from "./ui/toaster";
import type { UpgradeModalVariant } from "../stores/upgradeModalStore";

interface UpgradeModalProps {
  open: boolean;
  onClose: () => void;
  variant: UpgradeModalVariant;
}

export function UpgradeModal({ open, onClose, variant }: UpgradeModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(e) => !e.open && onClose()}>
      <Dialog.Content>
        <Dialog.CloseTrigger />
        {variant.mode === "limit" ? (
          <LimitContent variant={variant} onClose={onClose} />
        ) : (
          <SeatsContent variant={variant} onClose={onClose} open={open} />
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}

function LimitContent({
  variant,
  onClose,
}: {
  variant: Extract<UpgradeModalVariant, { mode: "limit" }>;
  onClose: () => void;
}) {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const { url: planManagementUrl, buttonLabel } = usePlanManagementUrl();

  const handleUpgrade = () => {
    trackEvent("subscription_hook_click", {
      project_id: project?.id,
      hook: `${variant.limitType}_limit_reached`,
    });
    void router.push(planManagementUrl);
    onClose();
  };

  return (
    <>
      <Dialog.Header>
        <Crown />
        <Dialog.Title>Upgrade Required</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body>
        <VStack gap={4} align="start">
          {typeof variant.max === "number" ? (
            <>
              <Text>
                You've reached the limit of {variant.max}{" "}
                {LIMIT_TYPE_LABELS[variant.limitType]} on your current plan.
              </Text>
              <Text color="gray.500">
                Current usage: {variant.current} / {variant.max}
              </Text>
            </>
          ) : (
            <Text>
              You've reached the limit of{" "}
              {LIMIT_TYPE_LABELS[variant.limitType]} on your current plan.
            </Text>
          )}
        </VStack>
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button colorPalette="blue" onClick={handleUpgrade}>
          {buttonLabel}
        </Button>
      </Dialog.Footer>
    </>
  );
}

function SeatsContent({
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
  const prorationQuery = subscriptionApi?.previewProration?.useQuery(
    {
      organizationId: variant.organizationId,
      newTotalSeats: variant.newSeats,
    },
    { enabled: open }
  ) as
    | {
        data?: {
          lineItems?: { description: string; amount: string }[];
          amountDue: string;
          recurringTotal: string;
        };
        isLoading: boolean;
        isError: boolean;
        error?: { message: string };
      }
    | undefined;

  const isLoading = prorationQuery?.isLoading ?? false;
  const isError = prorationQuery?.isError ?? false;
  const errorMessage =
    prorationQuery?.error?.message ?? "Failed to load proration preview";
  const data = prorationQuery?.data;

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
        <Dialog.Title>Confirm Seat Update</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body>
        {!subscriptionApi ? (
          <Text>Seat management is not available in this deployment.</Text>
        ) : isLoading ? (
          <HStack justify="center" width="100%" paddingY={6}>
            <Spinner />
          </HStack>
        ) : isError ? (
          <Text color="red.500">{errorMessage}</Text>
        ) : (
          <VStack gap={3} align="stretch">
            <Text>
              Current seats: {variant.currentSeats} → New seats:{" "}
              {variant.newSeats}
            </Text>
            {data?.lineItems?.map((item, index) => (
              <HStack key={index} justify="space-between">
                <Text fontSize="sm">{item.description}</Text>
                <Text fontSize="sm">{item.amount}</Text>
              </HStack>
            ))}
            <Separator />
            {data && (
              <>
                <HStack justify="space-between">
                  <Text fontWeight="medium">Due now (prorated):</Text>
                  <Text fontWeight="medium">{data.amountDue}</Text>
                </HStack>
                <HStack justify="space-between">
                  <Text fontWeight="medium">New recurring price:</Text>
                  <Text fontWeight="medium">{data.recurringTotal}/month</Text>
                </HStack>
              </>
            )}
          </VStack>
        )}
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="ghost" onClick={onClose} disabled={isConfirming}>
          Cancel
        </Button>
        <Button
          colorPalette="blue"
          onClick={() => void handleConfirm()}
          loading={isConfirming}
          disabled={isLoading || isError || !subscriptionApi}
        >
          Confirm & Update
        </Button>
      </Dialog.Footer>
    </>
  );
}
