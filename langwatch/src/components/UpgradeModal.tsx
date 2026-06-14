import {
  Badge,
  Button,
  HStack,
  Separator,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Crown, ShieldX } from "lucide-react";
import { useState } from "react";
import { useRouter } from "~/utils/compat/next-router";
import { type FeatureKey, featureIcons } from "~/utils/featureIcons";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { usePlanManagementUrl } from "../hooks/usePlanManagementUrl";
import { LIMIT_TYPE_LABELS } from "../server/license-enforcement/constants";
import type { LimitType } from "../server/license-enforcement/types";
import {
  type UpgradeModalVariant,
  useUpgradeModalStore,
} from "../stores/upgradeModalStore";
import { api } from "../utils/api";
import { trackEvent } from "../utils/tracking";
import { Dialog } from "./ui/dialog";
import { toaster } from "./ui/toaster";

/**
 * Limit types whose breakdown badges map to a standard feature icon and a
 * resource route. Icons come from the shared featureIcons source but render in
 * gray inside this dialog.
 */
const LIMIT_TYPE_TO_FEATURE: Partial<Record<LimitType, FeatureKey>> = {
  datasets: "datasets",
  workflows: "workflows",
  prompts: "prompts",
};

const resourceHref = (
  limitType: LimitType,
  projectSlug: string,
  resourceId: string,
): string | null => {
  switch (limitType) {
    case "datasets":
      return `/${projectSlug}/datasets/${resourceId}`;
    case "workflows":
      return `/${projectSlug}/studio/${resourceId}`;
    case "prompts":
      return `/${projectSlug}/prompts`;
    default:
      return null;
  }
};

interface UpgradeModalProps {
  open: boolean;
  onClose: () => void;
  variant: UpgradeModalVariant;
}

type VariantContentMap = {
  [K in UpgradeModalVariant["mode"]]: React.ComponentType<{
    variant: Extract<UpgradeModalVariant, { mode: K }>;
    onClose: () => void;
    open: boolean;
  }>;
};

export const MODAL_CONTENT: VariantContentMap = {
  limit: LimitContent,
  seats: SeatsContent,
  liteMemberRestriction: LiteMemberRestrictionContent,
};

export function UpgradeModal({ open, onClose, variant }: UpgradeModalProps) {
  // TS can't correlate variant.mode lookup with the matching variant type
  const Content = MODAL_CONTENT[variant.mode] as React.ComponentType<{
    variant: UpgradeModalVariant;
    onClose: () => void;
    open: boolean;
  }>;
  return (
    <Dialog.Root open={open} onOpenChange={(e) => !e.open && onClose()}>
      <Dialog.Content bg="bg">
        <Dialog.CloseTrigger />
        <Content variant={variant} onClose={onClose} open={open} />
      </Dialog.Content>
    </Dialog.Root>
  );
}

/**
 * Store-driven mount for the upgrade/limit dialog. Every full-screen
 * surface must render this once: limit-exceeded mutations open the
 * dialog through `useUpgradeModalStore`, and a surface without this
 * mount swallows the error into a silent no-op (the studio bug - the
 * dialog only "appeared" after navigating back to a dashboard page).
 */
export function GlobalUpgradeModal() {
  const { isOpen, variant, close } = useUpgradeModalStore();
  if (!variant) return null;
  return <UpgradeModal open={isOpen} onClose={close} variant={variant} />;
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

  const featureKey = LIMIT_TYPE_TO_FEATURE[variant.limitType];
  const FeatureIcon = featureKey ? featureIcons[featureKey].icon : null;
  const breakdown = api.licenseEnforcement.getLimitBreakdown.useQuery(
    { organizationId: organization?.id ?? "", limitType: variant.limitType },
    { enabled: !!organization?.id && !!featureKey },
  );

  const handleUpgrade = () => {
    trackEvent("subscription_hook_click", {
      project_id: project?.id,
      hook: `${variant.limitType}_limit_reached`,
    });
    void router.push(planManagementUrl);
    onClose();
  };

  const goToResource = (projectSlug: string, resourceId: string) => {
    const href = resourceHref(variant.limitType, projectSlug, resourceId);
    if (!href) return;
    void router.push(href);
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
              You've reached the limit of {LIMIT_TYPE_LABELS[variant.limitType]}{" "}
              on your current plan.
            </Text>
          )}

          {breakdown.data && breakdown.data.length > 0 && (
            <VStack
              gap={3}
              align="stretch"
              width="full"
              data-testid="limit-breakdown"
            >
              <Separator />
              <Text fontSize="xs" color="gray.500">
                Across your projects:
              </Text>
              {breakdown.data.map((proj) => (
                <VStack
                  key={proj.projectId}
                  gap={1.5}
                  align="start"
                  width="full"
                >
                  <Text fontSize="xs" fontWeight="medium" color="gray.600">
                    {proj.projectName}
                  </Text>
                  <HStack wrap="wrap" gap={2}>
                    {proj.resources.map((resource) => (
                      <Badge
                        key={resource.id}
                        variant="subtle"
                        colorPalette="gray"
                        color="gray.700"
                        cursor="pointer"
                        role="button"
                        tabIndex={0}
                        display="inline-flex"
                        alignItems="center"
                        gap={1}
                        onClick={() =>
                          goToResource(proj.projectSlug, resource.id)
                        }
                        data-testid="limit-breakdown-badge"
                      >
                        {FeatureIcon && <FeatureIcon size={12} />}
                        {resource.name}
                      </Badge>
                    ))}
                  </HStack>
                </VStack>
              ))}
            </VStack>
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

function LiteMemberRestrictionContent({
  onClose,
}: {
  variant: Extract<UpgradeModalVariant, { mode: "liteMemberRestriction" }>;
  onClose: () => void;
}) {
  return (
    <>
      <Dialog.Header>
        <ShieldX />
        <Dialog.Title>Feature Not Available</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body>
        <VStack gap={4} align="start">
          <Text>
            This feature is not available for your current role. Contact your
            organization admin for access.
          </Text>
        </VStack>
      </Dialog.Body>
      <Dialog.Footer>
        <Button colorPalette="blue" onClick={onClose}>
          Dismiss
        </Button>
      </Dialog.Footer>
    </>
  );
}
