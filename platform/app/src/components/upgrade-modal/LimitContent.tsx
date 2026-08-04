import { Button, Text, VStack } from "@chakra-ui/react";
import { Crown } from "lucide-react";
import { useRouter } from "~/utils/compat/next-router";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { usePlanManagementUrl } from "../../hooks/usePlanManagementUrl";
import { LIMIT_TYPE_LABELS } from "../../server/license-enforcement/constants";
import type { UpgradeModalVariant } from "../../stores/upgradeModalStore";
import { trackEvent } from "../../utils/tracking";
import { Dialog } from "../ui/dialog";

function LimitContentBody({
  variant,
}: {
  variant: Extract<UpgradeModalVariant, { mode: "limit" }>;
}) {
  return (
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
      </VStack>
    </Dialog.Body>
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
      <LimitContentBody variant={variant} />
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
