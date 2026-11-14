import { useOptionalUiHostServices } from "@langwatch/browser-host/capabilities";
import { AccessState } from "@langwatch/design-system/access-state";
import { Dialog } from "@langwatch/design-system/dialog";
import { Text, VStack } from "@langwatch/design-system/primitives";
import { LIMIT_TYPE_LABELS } from "@langwatch/enterprise-licensing-contract";

import type { UpgradeModalVariant } from "../../../model/upgrade-modal-store.ts";

/**
 * Seat allowances are the limits an admin runs into while doing the opposite
 * of upgrading: freeing a seat by disabling a membership instead.
 */
const SEAT_LIMIT_TYPES = new Set(["members", "membersLite"]);

/** Creation caps on the cloud Free plan: only one more is refused, what exists stays usable. */
const CREATION_LIMIT_TYPES = new Set(["scenarios", "scenarioSets", "evaluators"]);

/** What the license holds: a self-hosted install meets its license's limit, never a plan's. */
function limitWords({ isSaaS, isSeatLimit }: { isSaaS: boolean; isSeatLimit: boolean }): {
  dialogTitle: string;
  title: string;
  description: string;
  holder: string;
} {
  if (isSaaS) {
    return {
      dialogTitle: "Upgrade required",
      title: "You've reached your plan's limit",
      description:
        "Choose a plan with more capacity to continue, or ask an organization admin to review your plan.",
      holder: "your current plan",
    };
  }
  return {
    dialogTitle: isSeatLimit ? "No seats left on your license" : "License limit reached",
    title: isSeatLimit
      ? "All seats on your license are in use"
      : "You've reached your license's limit",
    description: isSeatLimit
      ? "Add seats to your license to invite more people. An organization admin manages the license."
      : "Raise this limit on your license to continue. An organization admin manages the license.",
    holder: "your license",
  };
}

/** What the plan or license allows, what is used, and the way to more. */
export function LimitContent({
  open,
  variant,
  isSaaS,
  onClose,
}: {
  open: boolean;
  variant: Extract<UpgradeModalVariant, { mode: "limit" }>;
  isSaaS: boolean;
  onClose: () => void;
}) {
  const buttonLabel = isSaaS ? "Compare plans" : "Manage license";
  const href = planManagementUrl(isSaaS);
  const navigation = useOptionalUiHostServices()?.navigation;
  const words = limitWords({ isSaaS, isSeatLimit: SEAT_LIMIT_TYPES.has(variant.limitType) });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={words.dialogTitle}
      size="md"
      primaryAction={{
        label: buttonLabel,
        href,
        onActivate: onClose,
        onNavigate: navigation ? ({ href: to }) => navigation.navigate(to) : undefined,
      }}
    >
      <AccessState kind="upgrade" title={words.title} compact description={words.description}>
        <VStack gap={4} align="start">
          {typeof variant.max === "number" ? (
            <>
              <Text>
                You've reached the limit of {variant.max} {LIMIT_TYPE_LABELS[variant.limitType]} on{" "}
                {words.holder}.
              </Text>
              <Text color="fg.muted">
                Current usage: {variant.current} / {variant.max}
              </Text>
            </>
          ) : (
            <Text>
              You've reached the limit of {LIMIT_TYPE_LABELS[variant.limitType]} on {words.holder}.
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
    </Dialog>
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
