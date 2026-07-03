import {
  Badge,
  Button,
  HStack,
  Separator,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Crown } from "lucide-react";
import { useRouter } from "~/utils/compat/next-router";
import { type FeatureKey, featureIcons } from "~/utils/featureIcons";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { usePlanManagementUrl } from "../../hooks/usePlanManagementUrl";
import { LIMIT_TYPE_LABELS } from "../../server/license-enforcement/constants";
import type { LimitBreakdownProject } from "../../server/license-enforcement/limit-breakdown";
import type { LimitType } from "../../server/license-enforcement/types";
import type { UpgradeModalVariant } from "../../stores/upgradeModalStore";
import { api } from "../../utils/api";
import { trackEvent } from "../../utils/tracking";
import { Dialog } from "../ui/dialog";

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

const resourceHref = ({
  limitType,
  projectSlug,
  resourceId,
}: {
  limitType: LimitType;
  projectSlug: string;
  resourceId: string;
}): string | null => {
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

function LimitBreakdownList({
  breakdown,
  featureKey,
  limitType,
  goToResource,
}: {
  breakdown: LimitBreakdownProject[];
  featureKey: FeatureKey | undefined;
  limitType: LimitType;
  goToResource: (args: { projectSlug: string; resourceId: string }) => void;
}) {
  const FeatureIcon = featureKey ? featureIcons[featureKey].icon : null;

  return (
    <VStack gap={3} align="stretch" width="full" data-testid="limit-breakdown">
      <Separator />
      <Text fontSize="xs" color="gray.500">
        Across your projects:
      </Text>
      {breakdown.map((proj) => (
        <VStack key={proj.projectId} gap={1.5} align="start" width="full">
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
                  goToResource({
                    projectSlug: proj.projectSlug,
                    resourceId: resource.id,
                  })
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    goToResource({
                      projectSlug: proj.projectSlug,
                      resourceId: resource.id,
                    });
                  }
                }}
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
  );
}

export function LimitContent({
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

  const goToResource = ({
    projectSlug,
    resourceId,
  }: {
    projectSlug: string;
    resourceId: string;
  }) => {
    const href = resourceHref({
      limitType: variant.limitType,
      projectSlug,
      resourceId,
    });
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
            <LimitBreakdownList
              breakdown={breakdown.data}
              featureKey={featureKey}
              limitType={variant.limitType}
              goToResource={goToResource}
            />
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
