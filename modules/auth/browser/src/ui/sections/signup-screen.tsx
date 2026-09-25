import { useEffect } from "react";

import { signIn, useSession } from "../../behavior/auth-client.tsx";
import { useIdentityFrontDoor } from "../../behavior/use-identity-front-door.ts";
import { usePublicEnv } from "../../behavior/use-public-env.ts";
import { useSearchParams } from "../../behavior/use-route.ts";
import { FrontDoorShell } from "../../ui/sections/front-door-shell.tsx";
import { VerificationFirstSignUp } from "../../ui/sections/verification-first-sign-up.tsx";

/**
 * The sign-up screen (ADR-117 §6). There is one: an account is created only by
 * spending the proof an emailed link returns, so every door that creates one
 * confirms the address first.
 */
export default function SignUp() {
  const frontDoor = useIdentityFrontDoor();

  if (!frontDoor.isResolved) return null;
  if (frontDoor.enabled) return <FrontDoorSignUp />;

  return <LegacyProviderRedirect />;
}

function FrontDoorSignUp() {
  return (
    // Hosted product pitch outside card; trustStrip empty until cleared for customer quote
    <FrontDoorShell
      headline={"See what your agents\nare actually doing."}
      headlineAccent="actually"
      tagline="You are a minute away from watching a simulated user push your agent until it breaks. Free to start, no credit card."
    >
      <VerificationFirstSignUp />
    </FrontDoorShell>
  );
}

/** Before the front door is enforced, a provider-backed deployment hands sign-up to it. */
function LegacyProviderRedirect() {
  const { data: session } = useSession();
  const publicEnv = usePublicEnv();
  const isAuthProvider = publicEnv.data?.NEXTAUTH_PROVIDER;
  const callbackUrl = useSearchParams()?.get("callbackUrl") ?? undefined;

  useEffect(() => {
    if (!publicEnv.data) {
      return;
    }

    if (!session && isAuthProvider && isAuthProvider !== "email") {
      void signIn(isAuthProvider, { callbackUrl });
    }
  }, [publicEnv.data, session, callbackUrl, isAuthProvider]);

  if (!publicEnv.data) {
    return null;
  }

  return isAuthProvider && isAuthProvider !== "email" ? (
    <div style={{ padding: "12px" }}>Redirecting to Sign in...</div>
  ) : (
    <FrontDoorSignUp />
  );
}
