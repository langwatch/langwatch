import { Text, VStack } from "@chakra-ui/react";
import { AuthCard } from "../../ui/elements/auth-card.tsx";
import { useSearchParams } from "../../behavior/use-route.ts";

/**
 * Email verification magic-link landing page; renders only, no request; proof stays in URL.
 *
 * ── Why there is no expired-link state here ─────────────────────────────
 *
 * Because this page never spends the link, it can never learn that the link is
 * dead. Whether a token is expired, already used or invented is the answer to
 * a request, and making one here is exactly what the design above forbids — a
 * scanner would spend somebody's verification for them. The expired-link
 * screen therefore lives where the token is actually spent: the initiating
 * window, and the sign-up landing at `/auth/signup?verify=`.
 *
 * What this page CAN know without asking anybody is whether the link carried a
 * token at all, and it says so, because a link with nothing in it is the one
 * dead end where "go back to your other window" is useless advice.
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
