import { useOptionalUiHostServices } from "@langwatch/browser-host/capabilities";
import { useDrawer } from "@langwatch/browser-host/drawer";
import { AccessState } from "@langwatch/design-system/access-state";
import { Dialog } from "@langwatch/design-system/dialog";
import { Text, VStack } from "@langwatch/design-system/primitives";
import { LIMIT_TYPE_LABELS } from "@langwatch/enterprise-licensing-contract";
import { InviteMemberDrawerToken } from "@langwatch/organization-client";

import type { UpgradeModalVariant } from "../../../model/upgrade-modal-store.ts";

/**
 * Seat allowances are the limits an admin runs into while doing the opposite
 * of upgrading: freeing a seat by disabling a membership instead.
 */
const SEAT_LIMIT_TYPES = new Set(["members", "membersLite"]);

/** Creation caps on the cloud Free plan: only one more is refused, what exists stays usable. */
const CREATION_LIMIT_TYPES = new Set(["scenarios", "evaluators"]);

/**
 * What the license holds: a self-hosted install meets its license's limit, never a plan's. An
 * admin at a cloud seat limit is the one who decides, so they get a way to let someone pay. Free
 * has no Lite seats at all, so an admin there is pointed to Billing only and to Growth.
 */
function limitWords({
  isSaaS,
  isSeatLimit,
  isAdmin,
  limitType,
}: {
  isSaaS: boolean;
  isSeatLimit: boolean;
  isAdmin: boolean;
  limitType?: string;
}): {
  dialogTitle: string;
  title: string;
  description: string;
  holder: string;
} {
  if (isSaaS && isSeatLimit && isAdmin && limitType === "membersLite") {
    return {
      dialogTitle: "Upgrade required",
      title: "Free has no Lite seats",
      description:
        "If the person you are inviting pays for LangWatch, invite them as Billing only. It takes no seat, shows the plan and invoices, and lets them upgrade. Growth has unlimited Lite members.",
      holder: "your current plan",
    };
  }
  if (isSaaS && isSeatLimit && isAdmin) {
    return {
      dialogTitle: "Upgrade required",
      title: "You've reached your plan's limit",
      description:
        "Upgrade to a plan with more seats. If someone else pays, invite them as Billing only: they take no seat and can upgrade for you.",
      holder: "your current plan",
    };
  }
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

type LimitContentProps = {
  open: boolean;
  variant: Extract<UpgradeModalVariant, { mode: "limit" }>;
  isSaaS: boolean;
  /** The viewer holds `organization:manage`, so they can invite the person who pays. */
  isAdmin?: boolean;
  onClose: () => void;
};

/** What the plan or license allows, what is used, and the way to more. */
export function LimitContent(props: LimitContentProps) {
  const offersBillingOnly =
    props.isSaaS && SEAT_LIMIT_TYPES.has(props.variant.limitType) && (props.isAdmin ?? false);
  if (offersBillingOnly) return <AdminSeatLimitContent {...props} />;
  return <LimitDialog {...props} isAdmin={false} />;
}

/** An admin at a cloud seat limit: Upgrade, or invite the person who pays as Billing only. */
function AdminSeatLimitContent(props: LimitContentProps) {
  const { openDrawer } = useDrawer();
  return (
    <LimitDialog
      {...props}
      isAdmin
      inviteSomeoneToPay={() => {
        props.onClose();
        openDrawer(InviteMemberDrawerToken, { initialSeat: "BILLING_ONLY" });
      }}
    />
  );
}

function LimitDialog({
  open,
  variant,
  isSaaS,
  isAdmin = false,
  onClose,
  inviteSomeoneToPay,
}: LimitContentProps & { inviteSomeoneToPay?: () => void }) {
  const isSeatLimit = SEAT_LIMIT_TYPES.has(variant.limitType);
  const buttonLabel = primaryLabel({ isSaaS, offersBillingOnly: inviteSomeoneToPay !== undefined });
  const href = planManagementUrl(isSaaS);
  const navigation = useOptionalUiHostServices()?.navigation;
  const words = limitWords({ isSaaS, isSeatLimit, isAdmin, limitType: variant.limitType });

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
      secondaryAction={
        inviteSomeoneToPay
          ? {
              label: "Invite someone to pay",
              onClick: inviteSomeoneToPay,
              "data-testid": "limit-invite-billing-only",
            }
          : undefined
      }
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
          {variant.limitType === "scenarioRuns" && (
            <Text color="fg.muted">
              The count starts again on the 1st of next month (UTC). Paid plans run scenarios
              without a cap.
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

/** An admin offered Billing only upgrades here; everyone else compares plans or the license. */
function primaryLabel({
  isSaaS,
  offersBillingOnly,
}: {
  isSaaS: boolean;
  offersBillingOnly: boolean;
}): string {
  if (offersBillingOnly) return "Upgrade";
  return isSaaS ? "Compare plans" : "Manage license";
}

/**
 * Where "upgrade" goes. A family-local copy of billing-web's pure
 * `planManagementUrl` — kept local since billing-web already depends on
 * licensing-web and the reverse edge would cycle.
 */
export function planManagementUrl(isSaaS: boolean): string {
  return isSaaS ? "/settings/subscription" : "/settings/license";
}
