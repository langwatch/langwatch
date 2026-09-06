import { Text, VStack } from "@chakra-ui/react";
import { AuthCard } from "../../components/auth/AuthCard";

/**
 * The email verification ceremony's magic-link LANDING page (D01). It
 * renders, and only ever renders: a mail scanner or a preview prefetch that
 * follows the link consumes nothing and verifies nothing. Completion is the
 * tRPC mutation `identity.completeVerification`, which needs the
 * signed-in user, the emailed token AND the PKCE code verifier the initiating
 * window kept — so this page only sends the person back to that window and
 * makes no request of its own. The link's proof stays in the URL: nothing is
 * copied into the DOM, where session-replay and RUM collectors scrape
 * attributes.
 *
 * Public route (no session): the person may open the link on a device that
 * holds no session at all.
 *
 * Spec: specs/identity/identifier-model.feature (verification scenarios).
 */
export default function VerifyEmail() {
  return (
    <AuthCard title="Almost there">
      <VStack align="stretch" gap={3} data-testid="verify-email-landing">
        <Text>
          Return to the window where you requested this verification to finish
          confirming your email address.
        </Text>
        <Text color="gray.600">
          Opening this link on its own does not confirm anything.
        </Text>
      </VStack>
    </AuthCard>
  );
}
