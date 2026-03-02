import { useRouter } from "next/router";
import { useState } from "react";
import {
  Badge,
  Box,
  Button,
  Grid,
  HStack,
  Separator,
  Skeleton,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Check, Crown, X } from "lucide-react";
import { Dialog } from "./ui/dialog";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { usePlanManagementUrl } from "../hooks/usePlanManagementUrl";
import { trackEvent } from "../utils/tracking";
import { LIMIT_TYPE_LABELS } from "../server/license-enforcement/constants";
import { api } from "../utils/api";
import { toaster } from "./ui/toaster";
import type { UpgradeModalVariant } from "../stores/upgradeModalStore";
import {
  FREE_PLAN_FEATURES,
  GROWTH_PLAN_FEATURES,
} from "./subscription/billing-plans";

interface UpgradeModalProps {
  open: boolean;
  onClose: () => void;
  variant: UpgradeModalVariant;
}

export function UpgradeModal({ open, onClose, variant }: UpgradeModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(e) => !e.open && onClose()}>
      <Dialog.Content
        {...(variant.mode === "limit" ? { maxWidth: "680px" } : {})}
      >
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

function PlanFeatureList({
  features,
  icon,
}: {
  features: string[];
  icon: "check" | "x";
}) {
  return (
    <VStack gap={2} align="start">
      {features.map((feature) => (
        <HStack key={feature} gap={2} align="start">
          <Box flexShrink={0} paddingTop="2px">
            {icon === "check" ? (
              <Check size={14} color="var(--chakra-colors-green-500)" />
            ) : (
              <X size={14} color="var(--chakra-colors-gray-400)" />
            )}
          </Box>
          <Text
            fontSize="sm"
            color={icon === "check" ? "fg.muted" : "fg.subtle"}
          >
            {feature}
          </Text>
        </HStack>
      ))}
    </VStack>
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
  const { project, organization } = useOrganizationTeamProject();
  const { url: planManagementUrl, buttonLabel } = usePlanManagementUrl();

  const organizationId = organization?.id;

  const activePlan = api.plan.getActivePlan.useQuery(
    { organizationId: organizationId! },
    {
      enabled: !!organizationId,
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  );

  const showComparison =
    activePlan.data?.planSource !== "license" &&
    activePlan.data?.overrideAddingLimitations !== true;

  const planName = activePlan.data?.name;

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
            <Text>
              You've reached the limit of <strong>{variant.max}{" "}
              {LIMIT_TYPE_LABELS[variant.limitType]}</strong> on your current plan.
            </Text>
          ) : (
            <Text>
              You've reached the limit of{" "} <strong>
              {LIMIT_TYPE_LABELS[variant.limitType]}</strong> on your current plan.
            </Text>
          )}

          {showComparison && (
            <Grid
              templateColumns="1fr 1fr"
              gap={5}
              width="full"
              paddingTop={1}
            >
              {/* Current plan column */}
              <VStack
                align="start"
                gap={3}
                paddingY={4}
                paddingX={4}
                borderWidth="1px"
                borderColor="border.muted"
                borderRadius="lg"
              >
                <Text fontWeight="semibold" fontSize="sm">
                  {activePlan.isLoading ? (
                    <Skeleton
                      as="span"
                      display="inline-block"
                      width="40px"
                      height="1em"
                    />
                  ) : (
                    planName ?? "Current"
                  )}{" "}
                  plan
                </Text>
                <PlanFeatureList features={FREE_PLAN_FEATURES} icon="x" />
              </VStack>

              {/* Growth plan column */}
              <VStack
                align="start"
                gap={3}
                paddingY={4}
                paddingX={4}
                borderWidth="2px"
                borderColor="border.solid"
                borderRadius="lg"
              >
                <HStack gap={2}>
                  <Text fontWeight="semibold" fontSize="sm">
                    Growth plan
                  </Text>
                  <Badge colorPalette="green" variant="surface" size="sm">
                    Recommended
                  </Badge>
                </HStack>
                <PlanFeatureList features={GROWTH_PLAN_FEATURES} icon="check" />
              </VStack>
            </Grid>
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
  // Build-time invariant: subscriptionApi shape is fixed per build (SaaS vs OSS)
  const hasSubscriptionApi = !!subscriptionApi;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const prorationQuery = subscriptionApi?.previewProration?.useQuery(
    {
      organizationId: variant.organizationId,
      newTotalSeats: variant.newSeats,
    },
    { enabled: open && hasSubscriptionApi },
  ) as
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
        <Crown />
        <Dialog.Title>Confirm seat update</Dialog.Title>
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
          <VStack gap={6} align="stretch" paddingY={2}>
            <HStack justify="space-between" paddingX={2}>
              <VStack align="start" gap={1}>
                <Text fontSize="sm" color="gray.500">
                  Current seats
                </Text>
                <Text fontSize="2xl" fontWeight="bold">
                  {variant.currentSeats}
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
                  {variant.newSeats}
                </Text>
              </VStack>
            </HStack>

            <Separator />

            {data && (
              <>
                <HStack justify="space-between" paddingX={2}>
                  <Text fontWeight="normal" fontSize="md" color="gray.500">
                    New billing amount
                  </Text>
                  <Text fontWeight="normal" fontSize="md" color="gray.500">
                    {data.formattedRecurringTotal}
                  </Text>
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
