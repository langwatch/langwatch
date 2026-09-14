import { Text, VStack } from "@chakra-ui/react";
import { AuthCard } from "../../ui/elements/auth-card.tsx";

/**
 * Email verification magic-link landing page; renders only, no request; proof stays in URL
 */
export default function VerifyEmail() {
  return (
    <AuthCard title="Almost there">
      <VStack align="stretch" gap={3} data-testid="verify-email-landing">
        <Text>
          Return to the window where you requested this verification to finish confirming your email
          address.
        </Text>
        <Text color="gray.600">Opening this link on its own does not confirm anything.</Text>
      </VStack>
    </AuthCard>
  );
}
