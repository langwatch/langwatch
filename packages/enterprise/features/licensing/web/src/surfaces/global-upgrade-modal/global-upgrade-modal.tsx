import { Button, Text, VStack } from "@chakra-ui/react";
import { Dialog } from "@langwatch/design-system/dialog";
import { LIMIT_TYPE_LABELS } from "@langwatch/enterprise-licensing-contract";
import { useUpgradeModalStore } from "@langwatch/ui-host/upgrade-modal-store";
import { Link } from "../../ui/elements/link";
import { planManagementUrl } from "./plan-management-url";

/**
 * Seat allowances are the limits an admin runs into while doing the opposite
 * of upgrading: freeing a seat by disabling a membership instead.
 */
const SEAT_LIMIT_TYPES = new Set(["members", "membersLite"]);

/**
 * Store-driven mount for the upgrade/limit dialog. Only "limit" renders
 * today — "seats" and "liteMemberRestriction" still render nothing, same
 * as before. specs/licensing/proration-preview.feature.
 */
export function GlobalUpgradeModal({ isSaaS }: { isSaaS: boolean }) {
  const { isOpen, variant, close } = useUpgradeModalStore();
  if (!variant || variant.mode !== "limit") return null;

  const buttonLabel = isSaaS ? "Upgrade Plan" : "Upgrade License";
  const href = planManagementUrl(isSaaS);

  return (
    <Dialog.Root open={isOpen} onOpenChange={(event) => !event.open && close()}>
      <Dialog.Content bg="bg">
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <Dialog.Title>Upgrade Required</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <VStack gap={4} align="start">
            {typeof variant.max === "number" ? (
              <>
                <Text>
                  You've reached the limit of {variant.max} {LIMIT_TYPE_LABELS[variant.limitType]}{" "}
                  on your current plan.
                </Text>
                <Text color="gray.500">
                  Current usage: {variant.current} / {variant.max}
                </Text>
              </>
            ) : (
              <Text>
                You've reached the limit of {LIMIT_TYPE_LABELS[variant.limitType]} on your current
                plan.
              </Text>
            )}
            {SEAT_LIMIT_TYPES.has(variant.limitType) && (
              <Text color="gray.500">
                To free a seat instead, disable a membership from the members page. That is
                reversible, and it keeps their role and everything they did.
              </Text>
            )}
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button asChild colorPalette="blue">
            <Link href={href} onClick={close}>
              {buttonLabel}
            </Link>
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
