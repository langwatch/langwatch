import { Link } from "@langwatch/browser-host/link";
import { AccessState } from "@langwatch/design-system/access-state";
import { Dialog } from "@langwatch/design-system/dialog";
import { Button, Text, VStack } from "@langwatch/design-system/primitives";
import { LIMIT_TYPE_LABELS } from "@langwatch/enterprise-licensing-contract";

import type { UpgradeModalVariant } from "../../../model/upgrade-modal-store.ts";

/**
 * Seat allowances are the limits an admin runs into while doing the opposite
 * of upgrading: freeing a seat by disabling a membership instead.
 */
const SEAT_LIMIT_TYPES = new Set(["members", "membersLite"]);

/** Creation caps on the cloud Free plan: only one more is refused, what exists stays usable. */
const CREATION_LIMIT_TYPES = new Set(["scenarios", "scenarioSets", "evaluators"]);

/** What the plan allows, what is used, and the way to a bigger plan. */
export function LimitContent({
  variant,
  isSaaS,
  onClose,
}: {
  variant: Extract<UpgradeModalVariant, { mode: "limit" }>;
  isSaaS: boolean;
  onClose: () => void;
}) {
  const buttonLabel = isSaaS ? "Compare plans" : "Manage license";
  const href = planManagementUrl(isSaaS);

  return (
    <>
      <Dialog.Header>
        <Dialog.Title>Upgrade required</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body>
        <AccessState
          kind="upgrade"
          title="You've reached your plan's limit"
          compact
          description="Choose a plan with more capacity to continue, or ask an organization admin to review your plan."
        >
          <VStack gap={4} align="start">
            {typeof variant.max === "number" ? (
              <>
                <Text>
                  You've reached the limit of {variant.max} {LIMIT_TYPE_LABELS[variant.limitType]}{" "}
                  on your current plan.
                </Text>
                <Text color="fg.muted">
                  Current usage: {variant.current} / {variant.max}
                </Text>
              </>
            ) : (
              <Text>
                You've reached the limit of {LIMIT_TYPE_LABELS[variant.limitType]} on your current
                plan.
              </Text>
            )}
            {CREATION_LIMIT_TYPES.has(variant.limitType) && (
              <Text color="fg.muted">
                Everything you already have keeps working and stays editable.
              </Text>
            )}
            {SEAT_LIMIT_TYPES.has(variant.limitType) && (
              <Text color="fg.muted">
                To free a seat instead, disable a membership from the members page. That is
                reversible, and it keeps their role and everything they did.
              </Text>
            )}
          </VStack>
        </AccessState>
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button asChild colorPalette="orange">
          <Link href={href} onClick={onClose}>
            {buttonLabel}
          </Link>
        </Button>
      </Dialog.Footer>
    </>
  );
}

/**
 * Where "upgrade" goes. A family-local copy of billing-web's pure
 * `planManagementUrl` — kept local since billing-web already depends on
 * licensing-web and the reverse edge would cycle.
 */
export function planManagementUrl(isSaaS: boolean): string {
  return isSaaS ? "/settings/subscription" : "/settings/license";
}
