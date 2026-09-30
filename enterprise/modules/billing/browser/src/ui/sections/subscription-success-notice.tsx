import { Alert } from "@chakra-ui/react";

/** The banner a checkout returns to, with the proration note after a plan change. */
export function SubscriptionSuccessNotice({ showUpgradeCredit }: { showUpgradeCredit: boolean }) {
  return (
    <Alert.Root status="success" data-testid="subscription-success">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>Subscription activated successfully!</Alert.Title>
        {showUpgradeCredit && (
          <Alert.Description data-testid="credit-notice">
            Your previous plan has been prorated. Any unused credit has been applied to your account
            and will offset future invoices.
          </Alert.Description>
        )}
      </Alert.Content>
    </Alert.Root>
  );
}
