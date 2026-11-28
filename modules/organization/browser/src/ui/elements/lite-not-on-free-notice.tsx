import { Banner } from "@langwatch/design-system/banner";
import { Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";

import { growthLiteLine, liteNotOnFreeText } from "../../model/free-plan-invite.ts";

/** Picking Lite on Free: why it does not fit, and the Billing only seat for whoever pays. */
export function LiteNotOnFreeNotice({
  emails,
  organizationName,
  growthSeatPrice,
  onInviteBillingOnly,
  onUpgrade,
  busy = false,
}: {
  emails: readonly string[];
  organizationName: string;
  growthSeatPrice?: string;
  onInviteBillingOnly: () => void;
  onUpgrade: () => void;
  busy?: boolean;
}) {
  return (
    <Banner
      status="info"
      title="Free has no Lite seats"
      data-testid="invite-lite-not-on-free"
      action={
        <VStack align="start" gap={2} width="full">
          <HStack gap={2}>
            <Button
              size="sm"
              colorPalette="orange"
              loading={busy}
              onClick={onInviteBillingOnly}
              data-testid="invite-as-billing-only"
            >
              Invite as Billing only
            </Button>
            <Button size="sm" variant="outline" onClick={onUpgrade} disabled={busy}>
              Upgrade to Growth
            </Button>
          </HStack>
          <Text textStyle="bodySm" color="fg.muted">
            {growthLiteLine(growthSeatPrice)}
          </Text>
        </VStack>
      }
    >
      {liteNotOnFreeText({ emails, organizationName })}
    </Banner>
  );
}
