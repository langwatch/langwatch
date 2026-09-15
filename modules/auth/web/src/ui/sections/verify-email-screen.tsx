import { Text, VStack } from "@chakra-ui/react";
import { AuthCard } from "../../ui/elements/auth-card.tsx";
import { useSearchParams } from "../../behavior/use-route.ts";

/**
 * Email verification magic-link landing page; renders only, no request; proof stays in URL.
 * There's no expired-link state here on purpose: this page never spends the link, so it can
 * never learn whether the token is expired, used or invented — making that request here is
 * exactly what a scanner spending someone else's verification would exploit. That state lives
 * where the token is actually spent instead (the initiating window, and the sign-up page).
 */
export default function VerifyEmail() {
  const query = useSearchParams();
  // Read for its PRESENCE and nothing else. The value is never held in state,
  // never passed down and never rendered — session-replay and RUM collectors
  // scrape DOM attributes.
  const carriesProof = Boolean(query?.get("token"));

  if (!carriesProof) {
    return (
      <AuthCard
        title="This link is incomplete"
        intro="Some email clients cut long links in half. Open the one in your inbox again, or copy the whole address into your browser."
      >
        <VStack align="stretch" gap={3} data-testid="verify-email-incomplete">
          <Text color="gray.600">
            If it keeps arriving broken, ask for a fresh verification email from the window where
            you requested this one.
          </Text>
        </VStack>
      </AuthCard>
    );
  }

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
