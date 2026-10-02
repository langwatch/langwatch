import { Text } from "@langwatch/design-system/primitives";

import { useSearchParams } from "../../behavior/use-route.ts";
import { AuthCard } from "../../ui/elements/auth-card.tsx";
import { SecondaryActionLink } from "../../ui/elements/secondary-action-link.tsx";
import { FrontDoorShell } from "./front-door-shell.tsx";

/**
 * Magic-link landing page: renders only, no request — proof stays in URL.
 * This page never spends the link (so it can't learn expired/used/invented),
 * which is exactly what a scanner spending someone else's link would exploit.
 */
export default function VerifyEmail() {
  return (
    <FrontDoorShell>
      <VerifyEmailCard />
    </FrontDoorShell>
  );
}

function VerifyEmailCard() {
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
        <Text color="fg.muted" data-testid="verify-email-incomplete">
          If it keeps arriving broken, ask for a fresh verification email from the window where you
          requested this one.
        </Text>
        <SecondaryActionLink href="/auth/signin" label="Back to sign in" />
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Almost there">
      <Text data-testid="verify-email-landing">
        Return to the window where you requested this verification to finish confirming your email
        address.
      </Text>
      <Text color="fg.muted">Opening this link on its own does not confirm anything.</Text>
      <SecondaryActionLink href="/auth/signin" label="Back to sign in" />
    </AuthCard>
  );
}
