import { useRouter } from "next/router";
import { Button, Text, VStack } from "@chakra-ui/react";
import { Dialog } from "./ui/dialog";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { trackEvent } from "../utils/tracking";
import { LIMIT_TYPE_LABELS } from "../server/license-enforcement/constants";
import type { LimitType } from "../server/license-enforcement/types";

interface UpgradeModalProps {
  open: boolean;
  onClose: () => void;
  limitType: LimitType;
  current?: number;
  max?: number;
}

export function UpgradeModal({
  open,
  onClose,
  limitType,
  current,
  max,
}: UpgradeModalProps) {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();

  const handleUpgrade = () => {
    trackEvent("subscription_hook_click", {
      project_id: project?.id,
      hook: `${limitType}_limit_reached`,
    });
    void router.push("/settings/license");
    onClose();
  };

  return (
    <Dialog.Root open={open} onOpenChange={(e) => !e.open && onClose()}>
      <Dialog.Content>
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <Dialog.Title>Upgrade Required</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <VStack gap={4} align="start">
            {typeof max === "number" ? (
              <>
                <Text>
                  You've reached the limit of {max} {LIMIT_TYPE_LABELS[limitType]} on
                  your current plan.
                </Text>
                <Text color="gray.500">
                  Current usage: {current} / {max}
                </Text>
              </>
            ) : (
              <Text>
                You've reached the limit of {LIMIT_TYPE_LABELS[limitType]} on your
                current plan.
              </Text>
            )}
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button colorPalette="blue" onClick={handleUpgrade}>
            Upgrade Plan
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
