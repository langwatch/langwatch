import { Text, VStack } from "@chakra-ui/react";
import { useSearchParams } from "~/utils/compat/next-navigation";
import { AuthCard } from "../../components/auth/AuthCard";

/**
 * The email verification ceremony's magic-link LANDING page (D01). It
 * renders, and only ever renders: a mail scanner or a preview prefetch that
 * follows the link consumes nothing and verifies nothing. Completion is the
 * identity RPC `POST /api/identity/verification.complete`, which needs the
 * signed-in user, the emailed token AND the PKCE code verifier the initiating
 * window kept — so the page carries the link's proof in the DOM for that
 * window and makes no request of its own.
 *
 * Public route (no session): the person may open the link on a device that
 * holds no session at all.
 *
 * Spec: specs/identity/identifier-model.feature (verification scenarios).
 */
export default function VerifyEmail() {
  const query = useSearchParams();
  const verificationId = query?.get("vid") ?? "";
  const token = query?.get("token") ?? "";

  return (
    <AuthCard title="Almost there">
      <VStack
        align="stretch"
        gap={3}
        data-testid="verify-email-landing"
        data-verification-id={verificationId}
        data-token={token}
      >
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
