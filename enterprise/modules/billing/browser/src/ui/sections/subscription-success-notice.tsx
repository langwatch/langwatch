import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { Check } from "lucide-react";

/** The banner a checkout returns to, with the proration note after a plan change. */
export function SubscriptionSuccessNotice({ showUpgradeCredit }: { showUpgradeCredit: boolean }) {
  return (
    <Box
      data-testid="subscription-success"
      backgroundColor="green.subtle"
      borderWidth={1}
      borderColor="green.muted"
      borderRadius="md"
      padding={4}
    >
      <VStack align="start" gap={1}>
        <HStack gap={2}>
          <Check size={16} color="var(--chakra-colors-green-solid)" />
          <Text fontWeight="semibold" color="green.fg">
            Subscription activated successfully!
          </Text>
        </HStack>
        {showUpgradeCredit && (
          <Text fontSize="sm" color="green.fg" data-testid="credit-notice">
            Your previous plan has been prorated. Any unused credit has been applied to your account
            and will offset future invoices.
          </Text>
        )}
      </VStack>
    </Box>
  );
}
