import { Text, VStack } from "@chakra-ui/react";
import { AuthCard } from "~/components/auth/AuthCard";
import {
  AuthShell,
  useIdentityAuthScreens,
} from "~/features/auth";
import { usePublishAuthStage } from "~/features/auth/logic/groundStage";
import { useSearchParams } from "~/utils/compat/next-navigation";

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
 * It is one of the auth screens' screens, so it is the auth screens' card on the
 * auth screens's ground — it was the one landing still rendering a bare card on
 * blank paper, which read as a different site to somebody who had just clicked
 * out of an email.
 *
 * ── Why there is no expired-link state here ─────────────────────────────
 *
 * Because this page never spends the link, it can never learn that the link is
 * dead. Whether a token is expired, already used or invented is the answer to
 * a request, and making one here is exactly what the design above forbids — a
 * scanner would spend somebody's verification for them. The expired-link
 * screen therefore lives where the token is actually spent: the initiating
 * window, and the sign-up landing at `/auth/signup?verify=`, which says the
 * link expired and offers a fresh one.
 *
 * What this page CAN know without asking anybody is whether the link carried a
 * token at all, and it says so, because a link with nothing in it is the one
 * dead end where "go back to your other window" is useless advice.
 *
 * Spec: specs/identity/identifier-model.feature (verification scenarios),
 * specs/identity/signin-signup-screens.feature.
 */
export default function VerifyEmail() {
  const auth = useIdentityAuthScreens();

  if (!auth.isResolved) return null;
  return auth.enabled ? (
    <AuthShell>
      <VerifyEmailLanding />
    </AuthShell>
  ) : (
    <VerifyEmailLanding />
  );
}

function VerifyEmailLanding() {
  const query = useSearchParams();
  // Read for its PRESENCE and nothing else. The value is never held in state,
  // never passed down and never rendered — see the note above about what
  // scrapes a DOM.
  const carriesProof = Boolean(query?.get("token"));

  usePublishAuthStage({ door: "signin", depth: "sent" });

  if (!carriesProof) {
    return (
      <AuthCard
        title="This link is incomplete"
        intro="Some email clients cut long links in half. Open the one in your inbox again, or copy the whole address into your browser."
      >
        <VStack align="stretch" gap={3} data-testid="verify-email-incomplete">
          <Text fontSize="13.5px" lineHeight="1.65" color="fg.muted">
            If it keeps arriving broken, ask for a fresh verification email from
            the window where you requested this one.
          </Text>
        </VStack>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Almost there">
      <VStack align="stretch" gap={3} data-testid="verify-email-landing">
        <Text fontSize="13.5px" lineHeight="1.65">
          Return to the window where you requested this verification to finish
          confirming your email address.
        </Text>
        <Text fontSize="13.5px" lineHeight="1.65" color="fg.muted">
          Opening this link on its own does not confirm anything.
        </Text>
      </VStack>
    </AuthCard>
  );
}
